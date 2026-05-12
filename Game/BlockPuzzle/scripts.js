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

const PLAYER_COLOR = "#4cc9f0"; // Battle mode player color
const ENEMY_COLOR = "#ef5350";  // Battle mode enemy color

const PIECE_SHAPES = [
    [[0,0]],
    [[0,0],[1,0]],
    [[0,0],[1,0],[2,0]],
    [[0,0],[1,0],[2,0],[3,0],[4,0]],
    [[0,0],[0,1]],
    [[0,0],[0,1],[0,2]],
    [[0,0],[1,0],[0,1],[1,1]],                     // 2x2
    [[0,0],[1,0],[2,0],[0,1]],                     // L
    [[0,0],[1,0],[2,0],[2,1]],                     // Reverse L
    [[1,0],[0,1],[1,1],[2,1]],                     // T
    [[0,0],[1,0],[2,0],[0,1],[2,1]],               // U
    [[0,0],[1,0],[2,0],
     [0,1],[1,1],[2,1],
     [0,2],[1,2],[2,2]]                            // 3x3
];

/* =========================================================
   DOM Elements
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
   Game State
========================================================= */
let gameMode = "normal"; // "normal" or "battle"

let board = [];
let currentPieces = [];
let enemyPieces = [];

let score = 0;
let enemyScore = 0;

let comboMultiplier = 1;
let playerComboActive = false;

let gameOver = false;
let dragging = null;

let undoState = null;

// true = show piece at upper-right of finger
// false = show piece at upper-left of finger
let rightHandMode = true;

/* =========================================================
   Utility
========================================================= */
function deepCopyBoard(src) {
    return src.map(row => [...row]);
}

function getRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function randomColor() {
    return getRandom(NORMAL_COLORS);
}

function getPieceColor(isEnemy = false) {
    if (gameMode === "battle") {
        return isEnemy ? ENEMY_COLOR : PLAYER_COLOR;
    }
    return randomColor();
}

function getShapeSize(shape) {
    let maxX = 0;
    let maxY = 0;

    for (const [x, y] of shape) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    return {
        w: maxX + 1,
        h: maxY + 1
    };
}

function randomPiece(isEnemy = false) {
    return {
        shape: getRandom(PIECE_SHAPES),
        color: getPieceColor(isEnemy)
    };
}