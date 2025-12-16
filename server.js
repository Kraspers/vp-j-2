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
const MODERATOR_MASTER_PASSWORD = process.env.MODERATOR_MASTER_PASSWORD || 'allvpj108';

function generateModeratorCode() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let code = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 5; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

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
  const isBot = req.query.bot === 'true';
  if (post) {
    if (!isBot) {
      post.views = (post.views || 0) + 1;
      writeData(data);
    }
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
  } else if (password === MODERATOR_MASTER_PASSWORD) {
    res.json({ role: 'moderator_admin' });
  } else if (password === 'newyear6') {
    const data = readData();
    data.isNewYear = !data.isNewYear;
    writeData(data);
    io.emit('theme-updated', { isNewYear: data.isNewYear });
    res.json({ role: null, themeToggled: true, isNewYear: data.isNewYear });
  } else {
    const data = readData();
    if (!data.moderatorCodes) data.moderatorCodes = [];
    const modCode = data.moderatorCodes.find(c => c.code === password);
    if (modCode) {
      res.json({ role: 'editor', codeName: modCode.name });
    } else {
      res.json({ role: null });
    }
  }
});

app.get('/api/moderator-codes', (req, res) => {
  const { masterPassword } = req.query;
  if (masterPassword !== MODERATOR_MASTER_PASSWORD) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const data = readData();
  res.json(data.moderatorCodes || []);
});

app.post('/api/moderator-codes', (req, res) => {
  const { masterPassword, name } = req.body;
  if (masterPassword !== MODERATOR_MASTER_PASSWORD) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const data = readData();
  if (!data.moderatorCodes) data.moderatorCodes = [];
  const newCode = {
    id: Date.now(),
    code: generateModeratorCode(),
    name: name || 'Без имени',
    createdAt: new Date().toISOString()
  };
  data.moderatorCodes.push(newCode);
  writeData(data);
  res.json(newCode);
});

app.put('/api/moderator-codes/:id', (req, res) => {
  const { masterPassword, name } = req.body;
  if (masterPassword !== MODERATOR_MASTER_PASSWORD) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const data = readData();
  const codeId = parseInt(req.params.id);
  const codeIndex = (data.moderatorCodes || []).findIndex(c => c.id === codeId);
  if (codeIndex === -1) {
    return res.status(404).json({ error: 'Code not found' });
  }
  data.moderatorCodes[codeIndex].name = name;
  writeData(data);
  res.json(data.moderatorCodes[codeIndex]);
});

app.delete('/api/moderator-codes/:id', (req, res) => {
  const { masterPassword } = req.body;
  if (masterPassword !== MODERATOR_MASTER_PASSWORD) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const data = readData();
  const codeId = parseInt(req.params.id);
  data.moderatorCodes = (data.moderatorCodes || []).filter(c => c.id !== codeId);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/keepalive', (req, res) => {
  res.json({ status: 'alive', connections: activeConnections });
});

app.get('/api/theme', (req, res) => {
  const data = readData();
  res.json({ isNewYear: data.isNewYear || false });
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

const PORT = process.env.PORT || 5000;
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

function createKeepAliveBot() {
  const https = require('https');
  const http = require('http');
  
  setInterval(() => {
    const data = readData();
    if (data.posts && data.posts.length > 0) {
      const randomPost = data.posts[Math.floor(Math.random() * data.posts.length)];
      const url = `${PUBLIC_URL}/api/posts/${randomPost.id}/view?bot=true`;
      
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(url, (res) => {
        res.on('data', () => {});
      });
      req.on('error', () => {});
    }
  }, 20000);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  
  setTimeout(() => {
    createKeepAliveBot();
    console.log('Keep-alive bot started');
  }, 1000);
});
