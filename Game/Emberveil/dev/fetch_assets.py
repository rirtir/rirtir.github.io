"""作者公式のCC0素材を取得。認証・支払いは不要。"""
from pathlib import Path
import requests, re, zipfile, io, json, hashlib

root=Path(__file__).resolve().parents[1]
session=requests.Session()
source='https://0x72.itch.io/dungeontileset-ii'
page=session.get(source,timeout=30); page.raise_for_status()
token=re.search(r'name="csrf_token" value="([^"]+)"',page.text).group(1)
response=session.post(source+'/download_url',data={'csrf_token':token},headers={'Referer':source},timeout=30)
response.raise_for_status()
download_page=session.get(response.json()['url'],timeout=30);download_page.raise_for_status()
uploads=re.findall(r'data-upload_id="(\d+)"',download_page.text)
if not uploads:
    (root/'dev'/'download-page.html').write_text(download_page.text,encoding='utf-8')
    raise RuntimeError('ダウンロードページ構造を確認してください')
print('Uploads:',uploads)
for upload in uploads:
    reply=session.post(f'https://0x72.itch.io/dungeontileset-ii/file/{upload}',data={'csrf_token':token},headers={'Referer':response.json()['url']},timeout=30)
    if reply.status_code!=200: continue
    data=reply.json()
    if 'url' not in data: continue
    binary=session.get(data['url'],timeout=45).content
    if not binary.startswith(b'PK'): continue
    archive=zipfile.ZipFile(io.BytesIO(binary))
    dest=root/'assets'/'dungeon'; dest.mkdir(parents=True,exist_ok=True)
    count=0
    for info in archive.infolist():
        path=Path(info.filename)
        if path.name.startswith('._'): continue
        if path.suffix=='.png' and 'frames' in path.parts:
            (dest/path.name).write_bytes(archive.read(info));count+=1
        elif path.name.lower().startswith(('readme','license')) and not info.is_dir():
            (dest/path.name).write_bytes(archive.read(info))
    (root/'assets'/'source.json').write_text(json.dumps({'author':'0x72 / Robert','source':source,'license':'CC0-1.0','retrieved':'2026-10-05','zip_sha256':hashlib.sha256(binary).hexdigest(),'frames':count},indent=2),encoding='utf-8')
    print('Saved official CC0 sprite frames:',count)
    break
else: raise RuntimeError('ZIPを取得できませんでした')
