const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const DATA_FILE = path.join(__dirname, 'data.json');

const SECRET_PASSWORD = process.env.SECRET_PASSWORD || 'allvpj106';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'allvpj107';

let activeConnections = 0;
let botConnections = new Set();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { posts: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/posts', (req, res) => {
  const data = readData();
  res.json(data.posts);
});

app.post('/api/posts', (req, res) => {
  const data = readData();
  const newPost = req.body;
  newPost.id = Date.now();
  newPost.views = 0;
  newPost.likes = 0;
  newPost.likedBy = [];
  data.posts.unshift(newPost);
  writeData(data);
  io.emit('posts-updated', data.posts);
  res.json(newPost);
});

app.put('/api/posts/:id', (req, res) => {
  const data = readData();
  const postId = parseInt(req.params.id);
  const index = data.posts.findIndex(p => p.id === postId);
  if (index !== -1) {
    const updatedPost = { ...data.posts[index], ...req.body };
    data.posts[index] = updatedPost;
    writeData(data);
    io.emit('posts-updated', data.posts);
    res.json(updatedPost);
  } else {
    res.status(404).json({ error: 'Post not found' });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  const data = readData();
  const postId = parseInt(req.params.id);
  data.posts = data.posts.filter(p => p.id !== postId);
  writeData(data);
  io.emit('posts-updated', data.posts);
  res.json({ success: true });
});

app.post('/api/posts/:id/view', (req, res) => {
  const data = readData();
  const postId = parseInt(req.params.id);
  const post = data.posts.find(p => p.id === postId);
  if (post) {
    post.views = (post.views || 0) + 1;
    writeData(data);
    io.emit('post-stats-updated', { id: postId, views: post.views, likes: post.likes });
    res.json({ views: post.views });
  } else {
    res.status(404).json({ error: 'Post not found' });
  }
});

app.post('/api/posts/:id/like', (req, res) => {
  const data = readData();
  const postId = parseInt(req.params.id);
  const { visitorId } = req.body;
  const post = data.posts.find(p => p.id === postId);
  if (post) {
    if (!post.likedBy) post.likedBy = [];
    const alreadyLiked = post.likedBy.includes(visitorId);
    if (alreadyLiked) {
      post.likedBy = post.likedBy.filter(id => id !== visitorId);
      post.likes = Math.max(0, (post.likes || 0) - 1);
    } else {
      post.likedBy.push(visitorId);
      post.likes = (post.likes || 0) + 1;
    }
    writeData(data);
    io.emit('post-stats-updated', { id: postId, views: post.views, likes: post.likes });
    res.json({ likes: post.likes, isLiked: !alreadyLiked });
  } else {
    res.status(404).json({ error: 'Post not found' });
  }
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === SECRET_PASSWORD) {
    res.json({ role: 'editor' });
  } else if (password === ADMIN_PASSWORD) {
    res.json({ role: 'admin' });
  } else {
    res.json({ role: null });
  }
});

app.get('/api/keepalive', (req, res) => {
  res.json({ status: 'alive', connections: activeConnections });
});

io.on('connection', (socket) => {
  const isBot = socket.handshake.query.bot === 'true';
  
  if (isBot) {
    botConnections.add(socket.id);
  } else {
    activeConnections++;
    console.log('User connected:', socket.id);
    const data = readData();
    socket.emit('posts-updated', data.posts);
  }
  
  socket.on('disconnect', () => {
    if (isBot) {
      botConnections.delete(socket.id);
    } else {
      activeConnections--;
      console.log('User disconnected:', socket.id);
    }
  });
});

function createKeepAliveBot() {
  const { io: ClientIO } = require('socket.io-client');
  const botSocket = ClientIO(`http://localhost:${PORT}`, {
    query: { bot: 'true' },
    reconnection: true,
    reconnectionDelay: 5000
  });
  
  botSocket.on('connect', () => {
    console.log('Keep-alive bot connected');
  });
  
  setInterval(() => {
    if (botSocket.connected) {
      botSocket.emit('ping');
    }
  }, 30000);
  
  return botSocket;
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  
  setTimeout(() => {
    for (let i = 0; i < 3; i++) {
      createKeepAliveBot();
    }
    console.log('Keep-alive bots started');
  }, 2000);
});