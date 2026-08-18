"""1台版14ゲームをEdge/CDPで1ラウンドずつ完走させるスモークテスト。"""

from __future__ import annotations

import asyncio
import json
import sys
import urllib.request

import websockets


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
DEBUG = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:9224").rstrip("/")
GAMES = [
    "word-wolf", "ng-word", "unanimous", "majority-predict", "minority-survival",
    "pair-sync", "telepathy-word", "five-seconds-three", "taboo-talk",
    "closest-estimate", "secret-thermometer", "bluff-definition", "coop-count",
    "answer-first-ogiri",
]


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


class Cdp:
    def __init__(self, socket):
        self.socket = socket
        self.serial = 0
        self.exceptions: list[str] = []

    async def call(self, method: str, params=None):
        self.serial += 1
        request_id = self.serial
        await self.socket.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await self.socket.recv())
            if message.get("method") == "Runtime.exceptionThrown":
                details = message.get("params", {}).get("exceptionDetails", {})
                self.exceptions.append(details.get("text", "JavaScript exception"))
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    async def evaluate(self, expression: str):
        result = await self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")


async def wait_for(cdp: Cdp, expression: str, timeout=5):
    for _ in range(timeout * 20):
        if await cdp.evaluate(expression):
            return
        await asyncio.sleep(0.05)
    raise TimeoutError(expression)


async def click(cdp: Cdp, action: str, index=0):
    expression = f"""
      (() => {{
        const nodes = [...document.querySelectorAll('[data-action="{action}"]:not([disabled])')];
        const node = nodes[{index}] || nodes[0];
        if (!node) return false;
        node.click(); return true;
      }})()
    """
    if not await cdp.evaluate(expression):
        raise RuntimeError(f"button not found: {action}")
    await asyncio.sleep(0.025)


async def complete_game(cdp: Cdp, slug: str):
    await cdp.call("Page.navigate", {"url": f"{BASE}/Game/PartyGames/one-device/games/{slug}/"})
    await wait_for(cdp, "Boolean(document.querySelector('[data-action=\"start-game\"]'))")
    size = await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth})")
    if size["scroll"] > size["width"]:
        raise AssertionError(f"horizontal overflow: {size}")
    await cdp.evaluate("document.getElementById('roundLimit').value='1'")
    await click(cdp, "start-game")

    coop_turn = 0
    for step in range(120):
        if await cdp.evaluate("Boolean(document.querySelector('[data-action=\"show-final\"]'))"):
            text = await cdp.evaluate("document.querySelector('.content').innerText")
            if "ROUND RESULT" not in text:
                raise AssertionError(f"result screen missing: {slug}")
            return

        actions = await cdp.evaluate("[...document.querySelectorAll('[data-action]:not([disabled])')].map(x=>x.dataset.action)")
        if not actions:
            text = await cdp.evaluate("document.body.innerText.slice(0,500)")
            raise RuntimeError(f"stuck in {slug}: {text}")

        if "reveal-turn" in actions: await click(cdp, "reveal-turn")
        elif "turn-done" in actions: await click(cdp, "turn-done")
        elif "start-wolf-vote" in actions: await click(cdp, "start-wolf-vote")
        elif "wolf-vote" in actions: await click(cdp, "wolf-vote")
        elif "finish-ng" in actions: await click(cdp, "finish-ng")
        elif "select-choice" in actions:
            await click(cdp, "select-choice"); await click(cdp, "select-prediction"); await click(cdp, "submit-majority")
        elif "submit-minority" in actions: await click(cdp, "submit-minority")
        elif "submit-text" in actions:
            value = "これはどんなとき？" if slug == "answer-first-ogiri" else f"テスト回答{step}"
            await cdp.evaluate(f"document.getElementById('textAnswer').value={json.dumps(value, ensure_ascii=False)}")
            await click(cdp, "submit-text")
        elif "submit-number" in actions:
            await cdp.evaluate("document.getElementById('numberAnswer').value='1'"); await click(cdp, "submit-number")
        elif "start-five" in actions: await click(cdp, "start-five")
        elif "five-result" in actions: await click(cdp, "five-result")
        elif "reveal-taboo" in actions: await click(cdp, "reveal-taboo")
        elif "start-taboo" in actions: await click(cdp, "start-taboo")
        elif "taboo-result" in actions: await click(cdp, "taboo-result")
        elif "reveal-thermo" in actions: await click(cdp, "reveal-thermo")
        elif "submit-clue" in actions:
            await cdp.evaluate("document.getElementById('clueAnswer').value='ほんのり暖かい'"); await click(cdp, "submit-clue")
        elif "submit-range" in actions: await click(cdp, "submit-range")
        elif "bluff-vote" in actions: await click(cdp, "bluff-vote")
        elif "ogiri-vote" in actions: await click(cdp, "ogiri-vote")
        elif "coop-speak" in actions:
            await click(cdp, "coop-speak", coop_turn % 2); coop_turn += 1
        else:
            raise RuntimeError(f"unhandled actions in {slug}: {actions}")
    raise RuntimeError(f"too many steps: {slug}")


async def main():
    target = next(item for item in get_json(DEBUG + "/json/list") if item.get("type") == "page")
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=2**22) as socket:
        cdp = Cdp(socket)
        await cdp.call("Runtime.enable")
        await cdp.call("Page.enable")
        await cdp.call("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True,
        })
        for slug in GAMES:
            before = len(cdp.exceptions)
            await complete_game(cdp, slug)
            if len(cdp.exceptions) != before:
                raise RuntimeError(f"JavaScript exception in {slug}: {cdp.exceptions[before:]}")
            print(f"  {slug}: OK")
    print("1台版14ゲーム: 390px幅・1ラウンド完走 OK")


if __name__ == "__main__":
    asyncio.run(main())
