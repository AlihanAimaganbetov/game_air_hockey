
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

const swarm = new Hyperswarm();
Pear.teardown(() => swarm.destroy());

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let isHost = false;
let gameState = null;
let firstPlayerImage = null;
let secondPlayerImage = null;

// Загрузка изображений
function loadImages() {
  return new Promise((resolve) => {
    firstPlayerImage = new Image();
    secondPlayerImage = new Image();

    let loaded = 0;
    const checkLoaded = () => {
      loaded++;
      if (loaded === 2) resolve();
    };

    firstPlayerImage.src = './images/first.png';
    secondPlayerImage.src = './images/second.png';

    firstPlayerImage.onload = checkLoaded;
    secondPlayerImage.onload = checkLoaded;
  });
}

// Настройка кнопок для создания игры или подключения
document.getElementById('create-game').addEventListener('click', createGame);
document.getElementById('join-form').addEventListener('submit', joinGame);

async function createGame() {
  const topicBuffer = crypto.randomBytes(32);
  await joinSwarm(topicBuffer);
  isHost = true;
  await startGame(topicBuffer);
  const topicHex = b4a.toString(topicBuffer, 'hex');
  document.getElementById('game-topic').innerText = topicHex;
  
}

async function joinGame(event) {
  event.preventDefault();
  const topicStr = document.getElementById('join-game-topic').value;
  const topicBuffer = b4a.from(topicStr, 'hex');
  await joinSwarm(topicBuffer);
  await startGame(topicBuffer);
}

async function joinSwarm(topicBuffer) {
  const discovery = swarm.join(topicBuffer, { client: true, server: true });
  await discovery.flushed();
}

swarm.on('connection', (peer) => {
  peer.on('data', (message) => {
    const data = JSON.parse(message.toString());

    if (isHost && data.type === 'requestState') {
      peer.write(JSON.stringify({ type: 'state', gameState }));
    }

    if (!isHost && data.type === 'state') {
      gameState = data.gameState;
    }

    if (isHost && data.type === 'input') {
      handleInputFromHost(data.input);
    }
  });

  peer.on('error', (err) => console.error('Peer error:', err));

  if (!isHost) {
    peer.write(JSON.stringify({ type: 'requestState' }));
  }
});

async function startGame(topicBuffer) {
  document.getElementById('setup').style.display = 'none';
  canvas.style.display = 'block';

  await loadImages(); // Загрузка изображений

  gameState = {
    players: [
      { x: 200, y: 100, dx: 0, dy: 0, radius: 20 },
      { x: 200, y: 700, dx: 0, dy: 0, radius: 20 },
    ],
    ball: { x: canvas.width / 2, y: canvas.height / 2, dx: 3, dy: 3, radius: 10 },
    goals: {
      top: { x1: 100, x2: 300, y: 0, hole: { x1: 180, x2: 220 }, color: 'yellow' },
      bottom: { x1: 100, x2: 300, y: 800, hole: { x1: 180, x2: 220 }, color: 'blue' },
    },
    score: { player1: 0, player2: 0 },
  };

  window.addEventListener('keydown', (e) => handleKeydown(e, gameState));
  window.addEventListener('keyup', (e) => handleKeyup(e, gameState));

  if (isHost) gameLoop();
}

function handleKeydown(e) {
  const player = isHost ? gameState.players[0] : gameState.players[1];
  if (e.key === 'ArrowUp') player.dy = -5;
  if (e.key === 'ArrowDown') player.dy = 5;
  if (e.key === 'ArrowLeft') player.dx = -5;
  if (e.key === 'ArrowRight') player.dx = 5;

  if (!isHost) sendInput({ key: e.key, action: 'down' });
}

function handleKeyup(e) {
  const player = isHost ? gameState.players[0] : gameState.players[1];
  if (['ArrowUp', 'ArrowDown'].includes(e.key)) player.dy = 0;
  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) player.dx = 0;

  if (!isHost) sendInput({ key: e.key, action: 'up' });
}

function updateGame(state) {
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    player.x += player.dx;
    player.y += player.dy;

    // Ограничение перемещения игроков
    if (i === 0) {
      // Игрок 1 не может перейти на участок игрока 2
      player.y = Math.max(player.radius, Math.min(canvas.height / 2 - player.radius, player.y));
    } else if (i === 1) {
      // Игрок 2 не может перейти на участок игрока 1
      player.y = Math.max(canvas.height / 2 + player.radius, Math.min(canvas.height - player.radius, player.y));
    }

    player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x));
  }

  const ball = state.ball;
  ball.x += ball.dx;
  ball.y += ball.dy;

  if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= canvas.width) ball.dx *= -1;

  // Проверка на гол
  if (
      ball.y - ball.radius <= state.goals.top.y &&
      ball.x > state.goals.top.hole.x1 &&
      ball.x < state.goals.top.hole.x2
  ) {
    state.score.player2++; // Увеличиваем счет игрока 2
    resetBall(state); // Мяч возрождается в центре
  } else if (
      ball.y + ball.radius >= state.goals.bottom.y &&
      ball.x > state.goals.bottom.hole.x1 &&
      ball.x < state.goals.bottom.hole.x2
  ) {
    state.score.player1++; // Увеличиваем счет игрока 1
    resetBall(state); // Мяч возрождается в центре
  } else if (
      ball.y - ball.radius <= state.goals.top.y ||
      ball.y + ball.radius >= state.goals.bottom.y
  ) {
    ball.dy *= -1;
  }

  // Проверка на столкновение с игроками
  for (const player of state.players) {
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < ball.radius + player.radius) {
      ball.dx *= -1;
      ball.dy *= -1;
    }
  }
}


function resetBall(state) {
  state.ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    dx: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2),
    dy: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2),
    radius: 10,
    color: 'white'
  };
}

function drawGame(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Рисуем фон
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Рисуем центральную линию
  ctx.strokeStyle = 'white';
  ctx.setLineDash([10, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  // Рисуем ворота для обоих игроков
  const { top, bottom } = state.goals;
  ctx.fillStyle = top.color;
  ctx.fillRect(top.x1, top.y, top.hole.x1 - top.x1, 10); // Левая часть верхних ворот
  ctx.fillRect(top.hole.x2, top.y, top.x2 - top.hole.x2, 10); // Правая часть верхних ворот

  ctx.fillStyle = bottom.color;
  ctx.fillRect(bottom.x1, bottom.y - 10, bottom.hole.x1 - bottom.x1, 10); // Левая часть нижних ворот
  ctx.fillRect(bottom.hole.x2, bottom.y - 10, bottom.x2 - bottom.hole.x2, 10); // Правая часть нижних ворот

  // Рисуем игроков
  ctx.drawImage(firstPlayerImage, state.players[0].x - 20, state.players[0].y - 20, 40, 40);
  ctx.drawImage(secondPlayerImage, state.players[1].x - 20, state.players[1].y - 20, 40, 40);

  // Рисуем мяч
  const ball = state.ball;
  ctx.fillStyle = ball.color;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Рисуем счет
  ctx.fillStyle = 'green';
  ctx.font = '20px monospace';
  ctx.fillText(`Player 1: ${state.score.player1}`, 20, 30);

  ctx.fillStyle = 'red';
  ctx.fillText(`Player 2: ${state.score.player2}`, 20, 60);
}


function gameLoop() {
  if (isHost) {
    updateGame(gameState);
    for (const peer of swarm.connections) {
      peer.write(JSON.stringify({ type: 'state', gameState }));
    }
  }
  drawGame(gameState);
  requestAnimationFrame(gameLoop);
}

