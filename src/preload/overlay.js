const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('flow', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, payload) => fn(payload)),
  onRecorderStart: (fn) => ipcRenderer.on('recorder:start', (_e, opts) => fn(opts)),
  onRecorderStop: (fn) => ipcRenderer.on('recorder:stop', () => fn()),
  onRecorderCancel: (fn) => ipcRenderer.on('recorder:cancel', () => fn()),
  sendRecording: (payload) => ipcRenderer.send('recorder:result', payload),
  sendRecorderError: (message) => ipcRenderer.send('recorder:error', message),
})
