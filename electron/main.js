const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')

const DIST_DIR = path.join(__dirname, '..', 'dist')
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

let server = null
let serverPort = 0

function configPath() {
  return path.join(app.getPath('userData'), 'region-config.json')
}

function readConfig() {
  try {
    return fs.readFileSync(configPath(), 'utf8')
  } catch (e) {
    // 首次运行时读取打包内置的默认配置
    try {
      return fs.readFileSync(path.join(DIST_DIR, 'data', 'region-config.json'), 'utf8')
    } catch (err) {
      return '{}'
    }
  }
}

function sendJson(res, status, text) {
  res.writeHead(status, {
    'Content-Type': MIME_TYPES['.json'],
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

function handleApi(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readConfig())
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, JSON.stringify({ error: 'method not allowed' }))
    return
  }

  let body = ''
  let aborted = false
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 5 * 1024 * 1024) {
      aborted = true
      req.destroy()
    }
  })
  req.on('end', () => {
    if (aborted) return
    try {
      const data = JSON.parse(body)
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('配置必须为对象')
      }
      fs.mkdirSync(path.dirname(configPath()), { recursive: true })
      fs.writeFileSync(configPath(), JSON.stringify(data, null, 2), 'utf8')
      sendJson(res, 200, JSON.stringify(data))
    } catch (e) {
      sendJson(res, 400, JSON.stringify({ error: e.message }))
    }
  })
}

function serveStatic(pathname, res) {
  let relative = decodeURIComponent(pathname)
  if (relative === '/') relative = '/index.html'

  const filePath = path.join(DIST_DIR, relative)
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=3600'
    })
    res.end(buffer)
  })
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname === '/api/region-config') {
        handleApi(req, res)
        return
      }
      if (url.pathname === '/data/region-config.json') {
        sendJson(res, 200, readConfig())
        return
      }
      serveStatic(url.pathname, res)
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port
      resolve(serverPort)
    })
  })
}

function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    title: '区域标注分布 · 全国',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadURL(startUrl)

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length) {
      const win = windows[0]
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    const startUrl =
      process.env.ELECTRON_START_URL || `http://127.0.0.1:${await startServer()}/`
    createWindow(startUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(startUrl)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (server) server.close()
})
