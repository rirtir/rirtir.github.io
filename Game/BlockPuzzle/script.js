/* =========================================================
   Constants
========================================================= */
const BOARD_SIZE = 9;
const BASE_SCORE = 100;

const POINTER_OFFSET_X_RIGHT = 60;
const POINTER_OFFSET_X_LEFT = -60;
const POINTER_OFFSET_Y = -80;

const NORMAL_COLORS = [
    "#4cc9f0",
    "#f72585",
    "#b5179e",
    "#7209b7",
    "#4361ee",
    "#44a56c",
    "#ff9800",
    "#fffb00"
];

const PLAYER_COLOR = "#4cc9f0";
const ENEMY_COLOR = "#ec6359";

const PIECE_SHAPES = [

    /* =====================================================
       Single
    ===================================================== */
    {
        shape: [[0,0]],
        weight: 8
    },

    /* =====================================================
       Lines
    ===================================================== */

    {
        shape: [[0,0],[1,0]],
        weight: 3
    },
    {
        shape: [[0,0],[1,0],[2,0]],
        weight: 3
    },
    {
        shape: [[0,0],[1,0],[2,0],[3,0]],
        weight: 2
    },
    {
        shape: [[0,0],[1,0],[2,0],[3,0],[4,0]],
        weight: 1
    },

    {
        shape: [[0,0],[0,1]],
        weight: 3
    },
    {
        shape: [[0,0],[0,1],[0,2]],
        weight: 3
    },
    {
        shape: [[0,0],[0,1],[0,2],[0,3]],
        weight: 2
    },
    {
        shape: [[0,0],[0,1],[0,2],[0,3],[0,4]],
        weight: 1
    },

    /* =====================================================
       Squares
    ===================================================== */

    {
        shape: [[0,0],[1,0],[0,1],[1,1]],
        weight: 4
    },

    {
        shape: [
            [0,0],[1,0],[2,0],
            [0,1],[1,1],[2,1],
            [0,2],[1,2],[2,2]
        ],
        weight: 2
    },

    /* =====================================================
       Small L (all rotations)
    ===================================================== */

    {
        shape: [[0,0],[0,1],[1,1]],
        weight: 1
    },
    {
        shape: [[0,0],[1,0],[0,1]],
        weight: 1
    },
    {
        shape: [[0,0],[1,0],[1,1]],
        weight: 1
    },
    {
        shape: [[1,0],[0,1],[1,1]],
        weight: 1
    },

    /* =====================================================
       Medium L (4 rotations)
    ===================================================== */

    {
        shape: [[0,0],[0,1],[0,2],[1,2]],
        weight: 1
    },
    {
        shape: [[0,0],[1,0],[2,0],[0,1]],
        weight: 1
    },
    {
        shape: [[0,0],[1,0],[1,1],[1,2]],
        weight: 1
    },
    {
        shape: [[2,0],[0,1],[1,1],[2,1]],
        weight: 1
    },

    /* =====================================================
       Big L (5 blocks)
    ===================================================== */

    {
        shape: [[0,0],[0,1],[0,2],[1,2],[2,2]],
        weight: 0.8
    },
    {
        shape: [[0,0],[1,0],[2,0],[0,1],[0,2]],
        weight: 0.8
    },
    {
        shape: [[0,0],[1,0],[2,0],[2,1],[2,2]],
        weight: 0.8
    },
    {
        shape: [[2,0],[2,1],[0,2],[1,2],[2,2]],
        weight: 0.8
    },

    /* =====================================================
       T Shapes (4 rotations)
    ===================================================== */

    {
        shape: [[0,0],[1,0],[2,0],[1,1]],
        weight: 1
    },
    {
        shape: [[0,1],[1,0],[1,1],[1,2]],
        weight: 1
    },
    {
        shape: [[1,0],[0,1],[1,1],[2,1]],
        weight: 1
    },
    {
        shape: [[0,0],[0,1],[1,1],[0,2]],
        weight: 1
    },

    /* =====================================================
       Extended T
    ===================================================== */

    // 0°
    {
        shape: [[0,0],[1,0],[2,0],[3,0],[1,1]],
        weight: 0.5
    },

    // 90°
    {
        shape: [[0,0],[0,1],[0,2],[0,3],[1,2]],
        weight: 0.5
    },

    // 180°
    {
        shape: [[0,1],[1,1],[2,1],[3,1],[2,0]],
        weight: 0.5
    },

    // 270°
    {
        shape: [[1,0],[1,1],[1,2],[1,3],[0,1]],
        weight: 0.5
    },

    // 0°
    {
        shape: [[0,0],[1,0],[2,0],[3,0],[2,1]],
        weight: 0.5
    },

    // 90°
    {
        shape: [[0,0],[0,1],[0,2],[0,3],[1,1]],
        weight: 0.5
    },

    // 180°
    {
        shape: [[0,1],[1,1],[2,1],[3,1],[1,0]],
        weight: 0.5
    },

    // 270°
    {
        shape: [[1,0],[1,1],[1,2],[1,3],[0,2]],
        weight: 0.5
    },

    /* =====================================================
       Z / S Shapes
    ===================================================== */

    {
        shape: [[0,0],[1,0],[1,1],[2,1]],
        weight: 1
    },
    {
        shape: [[1,0],[0,1],[1,1],[0,2]],
        weight: 1
    },

    {
        shape: [[1,0],[2,0],[0,1],[1,1]],
        weight: 1
    },
    {
        shape: [[0,0],[0,1],[1,1],[1,2]],
        weight: 1
    },

    /* =====================================================
       U / 凹 Shapes
    ===================================================== */

    // 0°
    {
        shape: [[0,0],[2,0],[0,1],[1,1],[2,1]],
        weight: 0.8
    },

    // 90°
    {
        shape: [[0,0],[1,0],[1,1],[0,2],[1,2]],
        weight: 0.8
    },

    // 180°
    {
        shape: [[0,0],[1,0],[2,0],[0,1],[2,1]],
        weight: 0.8
    },

    // 270°
    {
        shape: [[0,0],[0,1],[0,2],[1,0],[1,2]],
        weight: 0.8
    },

    // 0°
    {
        shape: [[0,0],[1,0],[0,1],[1,1],[0,2],[1,2],[2,1]],
        weight: 0.5
    },

    // 90°
    {
        shape: [[0,2],[0,1],[1,2],[1,1],[2,2],[2,1],[1,0]],
        weight: 0.5
    },

    // 180°
    {
        shape: [[0,1],[1,0],[2,0],[1,1],[2,1],[1,2],[2,2]],
        weight: 0.5
    },

    // 270°
    {
        shape: [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[1,2]],
        weight: 0.5
    },

    /* =====================================================
       Plus Shape
    ===================================================== */

    {
        shape: [[1,0],[0,1],[1,1],[2,1],[1,2]],
        weight: 2
    },

    /* =====================================================
       Weird / Asymmetric
    ===================================================== */

    {
        shape: [[0,0],[1,0],[2,0],[1,1],[1,2]],
        weight: 0.5
    },

    {
        shape: [[0,2],[0,1],[0,0],[1,1],[2,1]],
        weight: 0.5
    },

    {
        shape: [[2,2],[1,2],[0,2],[1,1],[1,0]],
        weight: 0.5
    },

    {
        shape: [[2,0],[2,1],[2,2],[1,1],[0,1]],
        weight: 0.5
    },

    {
        shape: [[0,0],[0,1],[1,1],[1,2],[2,2]],
        weight: 0.3
    },

    {
        shape: [[0,2],[1,2],[1,1],[2,1],[2,0]],
        weight: 0.3
    },

    {
        shape: [[2,2],[2,1],[1,1],[1,0],[0,0]],
        weight: 0.3
    },

    {
        shape: [[2,0],[1,0],[1,1],[0,1],[0,2]],
        weight: 0.3
    },

];

/* =========================================================
   DOM
========================================================= */
const titleScreen = document.getElementById("titleScreen");
const gameScreen = document.getElementById("gameScreen");

const normalModeButton = document.getElementById("normalModeButton");
const battleAIButton = document.getElementById("battleAIButton");
const battle2PButton = document.getElementById("battle2PButton");

const backButton = document.getElementById("backButton");
const undoButton = document.getElementById("undoButton");
const restartButton = document.getElementById("restartButton");
const handButton = document.getElementById("handButton");

const handIcon = document.getElementById("handIcon");

const boardElement = document.getElementById("board");
const scoreElement = document.getElementById("score");
const enemyScoreElement = document.getElementById("enemyScore");
const comboElement = document.getElementById("combo");
const messageElement = document.getElementById("message");
const enemyArea = document.getElementById("enemyArea");

const dragCanvas = document.getElementById("dragPiece");
const dragCtx = dragCanvas.getContext("2d");

const confirmPopup = document.getElementById("confirmPopup");
const popupMessage = document.getElementById("popupMessage");
const popupCancel = document.getElementById("popupCancel");
const popupOk = document.getElementById("popupOk");

/* =========================================================
   State
========================================================= */
let gameMode = "normal";
let board = [];
let currentPieces = [];
let enemyPieces = [];

let player1Score = 0;
let player2Score = 0;
let enemyScore = 0;

let comboMultiplier = 1;
let lastPlayerCleared = false;

let gameOver = false;
let dragging = null;
let rightHandMode = true;

let undoState = null;

let currentTurn = "player1";

/* =========================================================
   Utility
========================================================= */
function cloneState() {
    return {
        board: board.map(row => [...row]),
        currentPieces: structuredClone(currentPieces),
        enemyPieces: structuredClone(enemyPieces),
        player1Score,
        player2Score,
        enemyScore,
        comboMultiplier,
        lastPlayerCleared,
        gameOver
    };
}

function restoreState(state) {
    if (!state) return;
    board = state.board.map(row => [...row]);
    currentPieces = structuredClone(state.currentPieces);
    enemyPieces = structuredClone(state.enemyPieces);
    player1Score = state.player1Score;
    player2Score = state.player2Score;
    enemyScore = state.enemyScore;
    comboMultiplier = state.comboMultiplier;
    lastPlayerCleared = state.lastPlayerCleared;
    gameOver = state.gameOver;

    renderBoard();
    renderAllPieces();
    updateUI();
}

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function weightedRandomItem(items) {
    const totalWeight = items.reduce(
        (sum, item) => sum + item.weight,
        0
    );

    let r = Math.random() * totalWeight;

    for (const item of items) {
        r -= item.weight;
        if (r <= 0) {
            return item;
        }
    }

    return items[items.length - 1];
}

function getPieceColor(isEnemy = false) {
    if (
        gameMode === "battle_ai" ||
        gameMode === "battle_2p"
    ) {
        return isEnemy ? ENEMY_COLOR : PLAYER_COLOR;
    }

    return randomItem(NORMAL_COLORS);
}

function randomPiece(isEnemy = false) {
    const pieceData = weightedRandomItem(PIECE_SHAPES);

    return {
        shape: structuredClone(pieceData.shape),
        color: getPieceColor(isEnemy)
    };
}

function getShapeSize(shape) {
    let maxX = 0, maxY = 0;
    for (const [x, y] of shape) {
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return { w: maxX + 1, h: maxY + 1 };
}

function getPieceAnchor(shape) {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [x, y] of shape) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    if (rightHandMode) {
        // 右利き: 右下
        return {
            x: maxX,
            y: maxY
        };
    } else {
        // 左利き: 左下
        return {
            x: minX,
            y: maxY
        };
    }
}

function getPlacementOrigin(piece, anchorCellX, anchorCellY) {
    const anchor = getPieceAnchor(piece.shape);

    return {
        x: anchorCellX - anchor.x,
        y: anchorCellY - anchor.y
    };
}

function getDynamicOffsetX(clientX) {
    const rect = boardElement.getBoundingClientRect();

    // 盤面内の0〜1
    let t = (clientX - rect.left) / rect.width;

    // clamp
    t = Math.max(0, Math.min(1, t));

    const MAX_OFFSET = 80;

    if (rightHandMode) {
        // 右利き:
        // 指より少し左に補正
        return -(1 - t) * MAX_OFFSET;
    } else {
        // 左利き:
        // 指より少し右に補正
        return t * MAX_OFFSET;
    }
}

/* =========================================================
   Screen
========================================================= */
function showTitle() {
    titleScreen.classList.add("active");
    gameScreen.classList.remove("active");
}

function startGame(mode) {
    gameMode = mode;

    titleScreen.classList.remove("active");
    gameScreen.classList.add("active");

    const isBattle = (
        mode === "battle_ai" ||
        mode === "battle_2p"
    );

    const isAIBattle = (mode === "battle_ai");

    enemyArea.classList.toggle("hidden", !isBattle);
    enemyScoreElement.classList.toggle("hidden", !isBattle);

    currentTurn = "player1";

    initGame();

    if (mode === "battle_2p") {
        messageElement.textContent = "Blue Turn";
    }
}

/* =========================================================
   Initialization
========================================================= */
function initGame() {
    board = Array.from({ length: BOARD_SIZE }, () =>
        Array(BOARD_SIZE).fill(null)
    );

    currentPieces = [];
    enemyPieces = [];

    player1Score = 0;
    player2Score = 0;
    enemyScore = 0;

    comboMultiplier = 1;
    lastPlayerCleared = false;

    gameOver = false;
    dragging = null;
    undoState = null;

    createBoard();
    generatePlayerPieces();

    if (
        gameMode === "battle_ai" ||
        gameMode === "battle_2p"
    ) {
        generateEnemyPieces();
    }

    updateUI();
    messageElement.textContent = "";
}

function createBoard() {
    boardElement.innerHTML = "";

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            boardElement.appendChild(cell);
        }
    }

    renderBoard();
}

/* =========================================================
   Rendering
========================================================= */
function renderBoard() {
    const cells = boardElement.children;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const cell = cells[y * BOARD_SIZE + x];

            // Reset class
            cell.className = "cell";

            // Add thick borders every 3 cells
            if (x === 3 || x === 6) {
                cell.classList.add("subgrid-left");
            }

            if (y === 3 || y === 6) {
                cell.classList.add("subgrid-top");
            }

            // Filled state
            if (board[y][x]) {
                cell.classList.add("filled");
                cell.style.background = board[y][x];
            } else {
                cell.style.background = "";
            }
        }
    }
}

function drawPiece(ctx, piece, cellSize) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (const [x, y] of piece.shape) {
        ctx.fillStyle = piece.color;
        ctx.fillRect(
            x * cellSize + 1,
            y * cellSize + 1,
            cellSize - 2,
            cellSize - 2
        );
    }
}

function renderPieceSlot(slotElement, piece, isEnemy = false, index = -1) {
    slotElement.className = isEnemy
        ? "pieceSlot enemySlot"
        : "pieceSlot";

    slotElement.innerHTML = "";

    if (!piece) {
        slotElement.classList.add("used");
        return;
    }

    const size = getShapeSize(piece.shape);
    const cellSize = Math.max(
        10,
        Math.min(24, (slotElement.clientWidth - 20) / Math.max(size.w, size.h))
    );

    const canvas = document.createElement("canvas");
    canvas.className = "pieceCanvas";
    canvas.width = size.w * cellSize;
    canvas.height = size.h * cellSize;

    drawPiece(canvas.getContext("2d"), piece, cellSize);
    slotElement.appendChild(canvas);

    if (!isEnemy) {
        slotElement.classList.add("active");
        slotElement.onpointerdown = (e) => startDrag(e, index, cellSize);
    }
}

function renderAllPieces() {
    for (let i = 0; i < 3; i++) {
        renderPieceSlot(
            document.getElementById(`slot${i}`),
            currentPieces[i],
            false,
            i
        );

        if (
            gameMode === "battle_ai" ||
            gameMode === "battle_2p"
        ) {
            renderPieceSlot(
                document.getElementById(`enemySlot${i}`),
                enemyPieces[i],
                true,
                i
            );
        }
    }

    if (gameMode === "battle_2p") {
        const playerSlots = [
            document.getElementById("slot0"),
            document.getElementById("slot1"),
            document.getElementById("slot2")
        ];

        const enemySlots = [
            document.getElementById("enemySlot0"),
            document.getElementById("enemySlot1"),
            document.getElementById("enemySlot2")
        ];

        const playerDisabled = (currentTurn !== "player1");
        const enemyDisabled = (currentTurn !== "player2");

        for (const slot of playerSlots) {
            if (playerDisabled) {
                slot.classList.add("disabled-turn");
            }
        }

        for (const slot of enemySlots) {
            if (enemyDisabled) {
                slot.classList.add("disabled-turn");
            }
        }

        for (let i = 0; i < 3; i++) {
            if (enemyPieces[i] && currentTurn === "player2") {
                const slot = document.getElementById(`enemySlot${i}`);
                slot.classList.remove("disabled-turn");
                slot.classList.add("active");
                slot.onpointerdown = (e) => {
                    startDrag(e, i, 24, true);
                };
            }
        }
    }
}

function updateUI() {
    if (gameMode === "battle_2p") {
        scoreElement.textContent = `Blue: ${player1Score}`;
        enemyScoreElement.textContent = `Red: ${player2Score}`;
    } else {
        scoreElement.textContent = `Score: ${player1Score}`;
        enemyScoreElement.textContent = `Enemy: ${enemyScore}`;
    }

    comboElement.textContent =
        comboMultiplier > 1 ? `Combo x${comboMultiplier}` : "";

    if (gameOver) {
        messageElement.textContent = "Game Over!";
    }
}

/* =========================================================
   Piece Generation
========================================================= */
function generatePlayerPieces() {
    currentPieces = [randomPiece(), randomPiece(), randomPiece()];
    renderAllPieces();
}

function generateEnemyPieces() {
    enemyPieces = [
        randomPiece(true),
        randomPiece(true),
        randomPiece(true)
    ];
    renderAllPieces();
}

/* =========================================================
   Drag
========================================================= */
function startDrag(event, pieceIndex, cellSize, useEnemyPieces = false) {
    if (gameOver) return;

    const pieces = useEnemyPieces
        ? enemyPieces
        : currentPieces;

    const piece = pieces[pieceIndex];
    if (!piece) return;

    event.preventDefault();

    const size = getShapeSize(piece.shape);

    dragCanvas.width = size.w * cellSize;
    dragCanvas.height = size.h * cellSize;
    drawPiece(dragCtx, piece, cellSize);

    dragging = {
        pieceIndex,
        piece,
        width: dragCanvas.width,
        height: dragCanvas.height,
        useEnemyPieces
    };

    dragCanvas.style.display = "block";

    moveDrag(event);

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
}

function onPointerMove(e) {
    e.preventDefault();
    moveDrag(e);
}

function moveDrag(e) {
    if (!dragging) return;

    const offsetX = getDynamicOffsetX(e.clientX);

    // ハイライトと共通の論理位置
    const logicalX = e.clientX + offsetX;
    const logicalY = e.clientY + POINTER_OFFSET_Y;

    let left;

    if (rightHandMode) {
        // 論理位置の左側に配置
        left = logicalX - dragging.width;
    } else {
        // 論理位置の右側に配置
        left = logicalX;
    }

    // 論理位置の上側に配置
    const top = logicalY - dragging.height;

    dragCanvas.style.left = `${left}px`;
    dragCanvas.style.top = `${top}px`;

    highlightPlacement(logicalX, logicalY);
}

async function onPointerUp(e) {
    e.preventDefault();

    if (!dragging) return;

    let logicalX, logicalY;

    const offsetX = getDynamicOffsetX(e.clientX);
    logicalX = e.clientX + offsetX;
    logicalY = e.clientY + POINTER_OFFSET_Y;

    const anchorPos = getBoardCellFromPoint(logicalX, logicalY);

    if (anchorPos) {
        const origin = getPlacementOrigin(
            dragging.piece,
            anchorPos.x,
            anchorPos.y
        );

        if (canPlace(dragging.piece, origin.x, origin.y)) {
            undoState = cloneState();

            await placePiece(dragging.piece, origin.x, origin.y);

            const activePieces = dragging.useEnemyPieces
                ? enemyPieces
                : currentPieces;

            activePieces[dragging.pieceIndex] = null;
            renderAllPieces();

            if (gameMode === "battle_ai") {
                await enemyTurn();
            }

            if (currentPieces.every(p => p === null)) {
                generatePlayerPieces();
            }

            if (
                (gameMode === "battle_ai" ||
                gameMode === "battle_2p") &&
                enemyPieces.every(p => p === null)
            ) {
                generateEnemyPieces();
            }

            if (gameMode === "battle_2p") {
                currentTurn =
                    (currentTurn === "player1")
                        ? "player2"
                        : "player1";

                messageElement.textContent =
                    (currentTurn === "player1")
                        ? "Blue Turn"
                        : "Red Turn";

                renderAllPieces();
            }

            checkGameOver();
        }
    }

    clearHighlights();
    dragCanvas.style.display = "none";
    dragging = null;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
}

/* =========================================================
   Board Logic
========================================================= */
function canPlace(piece, baseX, baseY) {
    for (const [dx, dy] of piece.shape) {
        const x = baseX + dx;
        const y = baseY + dy;

        if (
            x < 0 || x >= BOARD_SIZE ||
            y < 0 || y >= BOARD_SIZE ||
            board[y][x] !== null
        ) {
            return false;
        }
    }
    return true;
}

async function placePiece(piece, baseX, baseY) {

    for (const [dx, dy] of piece.shape) {
        board[baseY + dy][baseX + dx] = piece.color;
    }

    renderBoard();

    await resolveClears();
}

function playClearAnimation(cells) {
    const elements = boardElement.children;

    for (const [x, y] of cells) {
        const cell = elements[y * BOARD_SIZE + x];
        cell.classList.add("clear-anim");
    }
}

function resolveClears() {

    return new Promise((resolve) => {

        const cellsToClear = findClearCells();

        if (cellsToClear.length === 0) {

            comboMultiplier = 1;
            lastPlayerCleared = false;

            updateUI();

            resolve();
            return;
        }

        // combo処理
        if (lastPlayerCleared) {
            comboMultiplier *= 2;
        } else {
            comboMultiplier = 2;
        }

        lastPlayerCleared = true;

        playClearAnimation(cellsToClear);

        const gained = Math.floor(
            BASE_SCORE * (cellsToClear.length / 9) * comboMultiplier
        );

        if (gameMode === "battle_2p") {
            if (currentTurn === "player1") {
                player1Score += gained;
            } else {
                player2Score += gained;
            }
        } else {
            player1Score += gained;
        }

        updateUI();

        setTimeout(() => {

            for (const [x, y] of cellsToClear) {
                board[y][x] = null;
            }

            renderBoard();

            const elements = boardElement.children;

            for (const [x, y] of cellsToClear) {
                const cell = elements[y * BOARD_SIZE + x];
                cell.classList.remove("clear-anim");
            }

            resolve();

        }, 200);
    });
}

function findClearCells() {
    const result = new Set();

    // Rows
    for (let y = 0; y < BOARD_SIZE; y++) {
        if (board[y].every(v => v !== null)) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                result.add(`${x},${y}`);
            }
        }
    }

    // Columns
    for (let x = 0; x < BOARD_SIZE; x++) {
        let full = true;
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (board[y][x] === null) {
                full = false;
                break;
            }
        }
        if (full) {
            for (let y = 0; y < BOARD_SIZE; y++) {
                result.add(`${x},${y}`);
            }
        }
    }

    // 3x3 blocks
    for (let by = 0; by < 3; by++) {
        for (let bx = 0; bx < 3; bx++) {
            let full = true;

            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 3; x++) {
                    if (board[by * 3 + y][bx * 3 + x] === null) {
                        full = false;
                    }
                }
            }

            if (full) {
                for (let y = 0; y < 3; y++) {
                    for (let x = 0; x < 3; x++) {
                        result.add(`${bx * 3 + x},${by * 3 + y}`);
                    }
                }
            }
        }
    }

    return [...result].map(s => s.split(",").map(Number));
}

/* =========================================================
   Enemy Turn
========================================================= */
async function enemyTurn() {
    const available = enemyPieces
        .map((piece, index) => ({ piece, index }))
        .filter(v => v.piece);

    if (available.length === 0) return;

    const selected = randomItem(available);
    const candidates = [];

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (canPlace(selected.piece, x, y)) {
                candidates.push({ x, y });
            }
        }
    }

    if (candidates.length === 0) return;

    const pos = randomItem(candidates);

    // Enemy placement does not affect player combo state
    const savedCombo = comboMultiplier;
    const savedLastCleared = lastPlayerCleared;
    const savedScore = player1Score;

    await placePiece(selected.piece, pos.x, pos.y);

    // Count enemy score roughly as occupied block count
    // enemyScore += selected.piece.shape.length * 10;

    // Restore player's combo state and score changes caused by enemy clears
    comboMultiplier = savedCombo;
    lastPlayerCleared = savedLastCleared;
    enemyScore += player1Score - savedScore;
    player1Score = savedScore;

    enemyPieces[selected.index] = null;

    renderAllPieces();
    updateUI();
}

/* =========================================================
   Highlight
========================================================= */
function getBoardCellFromPoint(clientX, clientY) {
    const rect = boardElement.getBoundingClientRect();

    if (
        clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom
    ) {
        return null;
    }

    const cellSize = rect.width / BOARD_SIZE;

    return {
        x: Math.floor((clientX - rect.left) / cellSize),
        y: Math.floor((clientY - rect.top) / cellSize)
    };
}

function highlightPlacement(clientX, clientY) {
    clearHighlights();

    if (!dragging) return;

    const anchorPos = getBoardCellFromPoint(clientX, clientY);
    if (!anchorPos) return;

    const origin = getPlacementOrigin(
        dragging.piece,
        anchorPos.x,
        anchorPos.y
    );

    const valid = canPlace(
        dragging.piece,
        origin.x,
        origin.y
    );

    const className = valid
        ? "highlight-valid"
        : "highlight-invalid";

    for (const [dx, dy] of dragging.piece.shape) {
        const x = origin.x + dx;
        const y = origin.y + dy;

        if (
            x < 0 || x >= BOARD_SIZE ||
            y < 0 || y >= BOARD_SIZE
        ) continue;

        boardElement.children[y * BOARD_SIZE + x]
            .classList.add(className);
    }
}

function clearHighlights() {
    for (const cell of boardElement.children) {
        cell.classList.remove("highlight-valid", "highlight-invalid");
    }
}

/* =========================================================
   Game Over
========================================================= */
function checkGameOver() {

    for (const piece of currentPieces) {

        if (!piece) continue;

        // 「アンカーセル」を全探索
        for (let anchorY = 0; anchorY < BOARD_SIZE; anchorY++) {

            for (let anchorX = 0; anchorX < BOARD_SIZE; anchorX++) {

                // 実際の配置時と同じ原点計算を使う
                const origin = getPlacementOrigin(
                    piece,
                    anchorX,
                    anchorY
                );

                if (canPlace(piece, origin.x, origin.y)) {
                    return;
                }
            }
        }
    }

    gameOver = true;
    updateUI();
}

/* =========================================================
   ポップアップ
========================================================= */

function showConfirm(message, onOk) {
    popupMessage.textContent = message;
    confirmPopup.classList.remove("hidden");

    const cleanup = () => {
        confirmPopup.classList.add("hidden");
        popupOk.onclick = null;
        popupCancel.onclick = null;
    };

    popupOk.onclick = () => {
        cleanup();
        onOk?.();
    };

    popupCancel.onclick = cleanup;
}

/* =========================================================
   Event Listeners
========================================================= */
normalModeButton.addEventListener("click", () => {
    startGame("normal");
});

battleAIButton.addEventListener("click", () => {
    startGame("battle_ai");
});

battle2PButton.addEventListener("click", () => {
    startGame("battle_2p");
});

backButton.addEventListener("click", () => {
    showConfirm("タイトルに戻りますか？", () => {
        showTitle();
    });
});
restartButton.addEventListener("click", () => {
    showConfirm("リスタートしますか？", () => {
        initGame();
    });
});

undoButton.addEventListener("click", () => {
    if (undoState) {
        restoreState(undoState);
        undoState = null;
    }
});

handButton.addEventListener("click", () => {
    rightHandMode = !rightHandMode;
    if (rightHandMode) {
        handIcon.style.transform = "scale(1, 1)";
    } else {
        handIcon.style.transform = "scale(-1, 1)";
    }
});

document.addEventListener("touchmove", (e) => {
    if (dragging) e.preventDefault();
}, { passive: false });

document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
});

/* =========================================================
   Start
========================================================= */
showTitle();