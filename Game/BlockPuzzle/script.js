/* =========================================================
   Constants
========================================================= */
const BOARD_SIZE = 9;
const BASE_SCORE = 100;

const NORMAL_COLORS = [
    "#4cc9f0",
    "#f72585",
    "#b5179e",
    "#7209b7",
    "#4361ee",
    "#4caf50",
    "#ff9800"
];

const PLAYER_COLOR = "#4cc9f0";
const ENEMY_COLOR = "#ef5350";

const PIECE_SHAPES = [
    [[0,0]],
    [[0,0],[1,0]],
    [[0,0],[1,0],[2,0]],
    [[0,0],[1,0],[2,0],[3,0],[4,0]],
    [[0,0],[0,1]],
    [[0,0],[0,1],[0,2]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[2,0],[0,1]],
    [[0,0],[1,0],[2,0],[2,1]],
    [[1,0],[0,1],[1,1],[2,1]],
    [[0,0],[1,0],[2,0],[0,1],[2,1]],
    [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]]
];

/* =========================================================
   DOM
========================================================= */
const titleScreen = document.getElementById("titleScreen");
const gameScreen = document.getElementById("gameScreen");

const normalModeButton = document.getElementById("normalModeButton");
const battleModeButton = document.getElementById("battleModeButton");

const backButton = document.getElementById("backButton");
const undoButton = document.getElementById("undoButton");
const restartButton = document.getElementById("restartButton");
const handButton = document.getElementById("handButton");

const boardElement = document.getElementById("board");
const titleElement = document.getElementById("title");
const scoreElement = document.getElementById("score");
const enemyScoreElement = document.getElementById("enemyScore");
const comboElement = document.getElementById("combo");
const messageElement = document.getElementById("message");
const enemyArea = document.getElementById("enemyArea");

const dragCanvas = document.getElementById("dragPiece");
const dragCtx = dragCanvas.getContext("2d");

/* =========================================================
   State
========================================================= */
let gameMode = "normal";
let board = [];
let currentPieces = [];
let enemyPieces = [];

let score = 0;
let enemyScore = 0;

let comboMultiplier = 1;
let lastPlayerCleared = false;

let gameOver = false;
let dragging = null;
let rightHandMode = true;

let undoState = null;

/* =========================================================
   Utility
========================================================= */
function cloneState() {
    return {
        board: board.map(row => [...row]),
        currentPieces: structuredClone(currentPieces),
        enemyPieces: structuredClone(enemyPieces),
        score,
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
    score = state.score;
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

function getPieceColor(isEnemy = false) {
    if (gameMode === "battle") {
        return isEnemy ? ENEMY_COLOR : PLAYER_COLOR;
    }
    return randomItem(NORMAL_COLORS);
}

function randomPiece(isEnemy = false) {
    return {
        shape: structuredClone(randomItem(PIECE_SHAPES)),
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

    enemyArea.classList.toggle("hidden", mode !== "battle");
    enemyScoreElement.classList.toggle("hidden", mode !== "battle");
    titleElement.classList.toggle("hidden", mode === "battle");

    initGame();
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

    score = 0;
    enemyScore = 0;

    comboMultiplier = 1;
    lastPlayerCleared = false;

    gameOver = false;
    dragging = null;
    undoState = null;

    createBoard();
    generatePlayerPieces();

    if (gameMode === "battle") {
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
            cell.className = "cell";

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

        if (gameMode === "battle") {
            renderPieceSlot(
                document.getElementById(`enemySlot${i}`),
                enemyPieces[i],
                true,
                i
            );
        }
    }
}

function updateUI() {
    scoreElement.textContent = `Score: ${score}`;
    enemyScoreElement.textContent = `Enemy: ${enemyScore}`;

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
function startDrag(event, pieceIndex, cellSize) {
    if (gameOver) return;

    const piece = currentPieces[pieceIndex];
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
        height: dragCanvas.height
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

    let left, top;

    if (rightHandMode) {
        left = e.clientX + 30;
    } else {
        left = e.clientX - dragging.width - 30;
    }

    top = e.clientY - dragging.height - 30;

    dragCanvas.style.left = `${left}px`;
    dragCanvas.style.top = `${top}px`;

    highlightPlacement(e.clientX, e.clientY);
}

function onPointerUp(e) {
    e.preventDefault();

    if (!dragging) return;

    const pos = getBoardCellFromPoint(e.clientX, e.clientY);

    if (pos && canPlace(dragging.piece, pos.x, pos.y)) {
        undoState = cloneState();

        placePiece(dragging.piece, pos.x, pos.y);

        currentPieces[dragging.pieceIndex] = null;
        renderAllPieces();

        if (gameMode === "battle") {
            enemyTurn();
        }

        if (currentPieces.every(p => p === null)) {
            generatePlayerPieces();
        }

        if (gameMode === "battle" && enemyPieces.every(p => p === null)) {
            generateEnemyPieces();
        }

        checkGameOver();
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

function placePiece(piece, baseX, baseY) {
    for (const [dx, dy] of piece.shape) {
        board[baseY + dy][baseX + dx] = piece.color;
    }

    renderBoard();
    resolveClears();
}

function resolveClears() {
    const cellsToClear = findClearCells();

    if (cellsToClear.length === 0) {
        comboMultiplier = 1;
        lastPlayerCleared = false;
        updateUI();
        return;
    }

    if (lastPlayerCleared) {
        comboMultiplier *= 2;
    } else {
        comboMultiplier = 2;
    }

    lastPlayerCleared = true;

    for (const [x, y] of cellsToClear) {
        board[y][x] = null;
    }

    const gained = Math.floor(
        BASE_SCORE * (cellsToClear.length / 9) * comboMultiplier
    );

    score += gained;

    renderBoard();
    updateUI();
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
function enemyTurn() {
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
    const savedScore = score;

    placePiece(selected.piece, pos.x, pos.y);

    // Count enemy score roughly as occupied block count
    enemyScore += selected.piece.shape.length * 10;

    // Restore player's combo state and score changes caused by enemy clears
    comboMultiplier = savedCombo;
    lastPlayerCleared = savedLastCleared;
    enemyScore += score - savedScore;
    score = savedScore;

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

    const pos = getBoardCellFromPoint(clientX, clientY);
    if (!pos) return;

    const valid = canPlace(dragging.piece, pos.x, pos.y);
    const className = valid ? "highlight-valid" : "highlight-invalid";

    for (const [dx, dy] of dragging.piece.shape) {
        const x = pos.x + dx;
        const y = pos.y + dy;

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

        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (canPlace(piece, x, y)) {
                    return;
                }
            }
        }
    }

    gameOver = true;
    updateUI();
}

/* =========================================================
   Event Listeners
========================================================= */
normalModeButton.addEventListener("click", () => startGame("normal"));
battleModeButton.addEventListener("click", () => startGame("battle"));

backButton.addEventListener("click", showTitle);
restartButton.addEventListener("click", initGame);

undoButton.addEventListener("click", () => {
    if (undoState) {
        restoreState(undoState);
        undoState = null;
    }
});

handButton.addEventListener("click", () => {
    rightHandMode = !rightHandMode;
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