const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg)

contextBridge.exposeInMainWorld('flow', {
  getSettings: invoke('settings:get'),
  updateSettings: invoke('settings:update'),
  listHistory: invoke('history:list'),
  deleteHistory: invoke('history:delete'),
  getStats: invoke('stats:get'),
  getActivity: invoke('activity:get'),
  listDictionary: invoke('dictionary:list'),
  addDictionary: invoke('dictionary:add'),
  removeDictionary: invoke('dictionary:remove'),
  copy: invoke('clipboard:copy'),
  getPermissions: invoke('permissions:get'),
  requestPermission: invoke('permissions:request'),
  toggleDictation: invoke('dictation:toggle'),
  onChanged: (fn) => ipcRenderer.on('hub:changed', () => fn()),
})
