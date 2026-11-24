const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("veyra", {
  loadProject: () => ipcRenderer.invoke("project:load"),
  readFile: r => ipcRenderer.invoke("file:read", r),
  writeFile: (r, t) => ipcRenderer.invoke("file:write", r, t),
  render: () => ipcRenderer.invoke("render:start"),
  onRender: cb => ipcRenderer.on("render:event", (_, l) => cb(l)),
});
