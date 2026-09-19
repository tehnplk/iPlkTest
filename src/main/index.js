// ต้องมาก่อนทุก import ที่อ่าน process.env ตอนโหลด (agent-ai, tools/sql, tools/api)
import './env.mjs'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { store } from './store.mjs'
import { askAgentAi, closeAgent, MODELS, buildSystem } from './agent-ai.mjs'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const db = await store()
  await db.purgeEmpty()
  ipcMain.handle('convos:list', () => db.list())
  ipcMain.handle('convos:create', (_e, title) => db.create(title))
  ipcMain.handle('convos:save', (_e, convo) => db.save(convo))
  ipcMain.handle('convos:delete', (_e, id) => db.remove(id))

  // ปุ่มหยุด: ยกเลิกทั้ง request ที่ค้างและ query ที่กำลังรัน
  let running = null
  ipcMain.handle('agent:stop', () => running?.abort())
  ipcMain.handle('file:open', (_e, path) => shell.openPath(path))
  ipcMain.handle('agent:models', () => MODELS)

  // agent ถามผู้ใช้ก่อนรันคำสั่งเสี่ยง — รอคำตอบจากหน้าจอ
  let approvals = 0
  const pending = new Map()
  ipcMain.handle('agent:approve', (_e, id, ok) => pending.get(id)?.(ok))

  ipcMain.handle('agent:send', async (e, messages, model) => {
    running = new AbortController()
    // onStep = sql ที่กำลังรัน, onDelta = ตัวอักษรที่โมเดลพิมพ์ ส่งให้ UI โชว์สดๆ
    const run = askAgentAi(messages, {
      model,
      onStep: (s) => e.sender.send('agent:step', s),
      onDelta: (d) => e.sender.send('agent:delta', d),
      signal: running.signal,
      instructions: await buildSystem(),
      downloadsDir: app.getPath('downloads'),
      onApproval: (info) =>
        new Promise((resolve) => {
          const id = ++approvals
          pending.set(id, (ok) => {
            pending.delete(id)
            resolve(ok)
          })
          e.sender.send('agent:approval', { id, ...info })
        })
    })
    return run.finally(() => (running = null))
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  closeAgent()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
