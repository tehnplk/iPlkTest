import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  convos: {
    list: () => ipcRenderer.invoke('convos:list'),
    create: (title) => ipcRenderer.invoke('convos:create', title),
    save: (convo) => ipcRenderer.invoke('convos:save', convo),
    remove: (id) => ipcRenderer.invoke('convos:delete', id)
  },
  openFile: (path) => ipcRenderer.invoke('file:open', path),
  agent: {
    send: (messages, model, engine) => ipcRenderer.invoke('agent:send', messages, model, engine),
    approve: (id, ok) => ipcRenderer.invoke('agent:approve', id, ok),
    onApproval: (cb) => {
      const handler = (_e, info) => cb(info)
      ipcRenderer.on('agent:approval', handler)
      return () => ipcRenderer.off('agent:approval', handler)
    },
    models: () => ipcRenderer.invoke('agent:models'),
    stop: () => ipcRenderer.invoke('agent:stop'),
    onStep: (cb) => {
      const handler = (_e, step) => cb(step)
      ipcRenderer.on('agent:step', handler)
      return () => ipcRenderer.off('agent:step', handler)
    },
    onDelta: (cb) => {
      const handler = (_e, text) => cb(text)
      ipcRenderer.on('agent:delta', handler)
      return () => ipcRenderer.off('agent:delta', handler)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
