// Clicking the toolbar icon opens the app in its own tab. If one is already open, it's brought to the
// front instead of piling up new tabs.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
  const [existing] = await chrome.tabs.query({ url: `${url}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
