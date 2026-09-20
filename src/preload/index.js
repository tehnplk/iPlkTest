import { contextBridge, ipcRenderer } from 'electron'

// subscribe ช่อง push จาก main — คืนฟังก์ชันเลิกฟังให้ useEffect เก็บกวาด
const on = (channel) => (cb) => {
  const handler = (_e, value) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api = {
  convos: {
    list: () => ipcRenderer.invoke('convos:list'),
    create: (title) => ipcRenderer.invoke('convos:create', title),
    save: (convo) => ipcRenderer.invoke('convos:save', convo),
    remove: (id) => ipcRenderer.invoke('convos:delete', id),
    archive: (id, on) => ipcRenderer.invoke('convos:archive', id, on)
  },
  openFile: (path) => ipcRenderer.invoke('file:open', path),
  agent: {
    send: (messages, model) => ipcRenderer.invoke('agent:send', messages, model),
    models: () => ipcRenderer.invoke('agent:models'),
    stop: () => ipcRenderer.invoke('agent:stop'),
    onStep: on('agent:step'),
    onDelta: on('agent:delta')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
