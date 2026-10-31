/* Finder Shortcut – Zotero plugin
 * Adds "Copy Finder Shortcut" to the item right-click menu.
 * It creates Finder aliases to the items' PDFs and puts them on the clipboard,
 * so ⌘V in any Finder folder pastes them.
 */

var registeredMenuID;
var pluginRootURI;
const FTL = "finder-shortcut.ftl";
const LABEL = "Copy Finder Shortcut";
const ACCEL_TEXT = "⌥⌘C";
const keyListeners = new WeakMap();

function runCopy(items) {
  copyFinderShortcuts(items || []).catch(e => {
    Zotero.logError(e);
    Services.prompt.alert(null, "Finder Shortcut – error", String(e));
  });
}

function install() {}
function uninstall() {}

function startup({ id, rootURI }) {
  pluginRootURI = rootURI;
  registeredMenuID = Zotero.MenuManager.registerMenu({
    menuID: "finder-shortcut-item-menu",
    pluginID: id,
    target: "main/library/item",
    menus: [{
      menuType: "menuitem",
      l10nID: "finder-shortcut-menu",
      icon: rootURI + "content/icons/menu.svg",
      onShowing: (event, context) => {
        // Fallback label in case the localization file isn't loaded yet
        if (!context.menuElem.getAttribute("label")) {
          context.menuElem.setAttribute("label", LABEL);
        }
        // Show the keyboard shortcut next to the menu entry
        context.menuElem.setAttribute("acceltext", ACCEL_TEXT);
      },
      onCommand: (event, context) => runCopy(context.items),
    }],
  });

  for (const win of Zotero.getMainWindows()) onMainWindowLoad({ window: win });
}

function onMainWindowLoad({ window }) {
  window.MozXULElement.insertFTLIfNeeded(FTL);

  // Keyboard shortcut: Option-Command-C in the library view
  if (keyListeners.has(window)) return;
  const listener = (event) => {
    if (event.code !== "KeyC" || !event.metaKey || !event.altKey
        || event.shiftKey || event.ctrlKey) return;
    if (window.Zotero_Tabs && window.Zotero_Tabs.selectedType !== "library") return;
    const items = window.ZoteroPane.getSelectedItems();
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    runCopy(items);
  };
  window.addEventListener("keydown", listener, true);
  keyListeners.set(window, listener);
}

function onMainWindowUnload({ window }) {
  window.document.querySelector(`[href="${FTL}"]`)?.remove();
  const listener = keyListeners.get(window);
  if (listener) {
    window.removeEventListener("keydown", listener, true);
    keyListeners.delete(window);
  }
}

function shutdown() {
  if (registeredMenuID) Zotero.MenuManager.unregisterMenu(registeredMenuID);
  for (const win of Zotero.getMainWindows()) onMainWindowUnload({ window: win });
}

async function copyFinderShortcuts(items) {
  if (!items.length) return;
  const { IOUtils, PathUtils } = Zotero.getMainWindow();

  // Fresh temporary folder for the aliases
  const dir = PathUtils.join(PathUtils.tempDir, "zotero-finder-shortcuts");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir);

  const args = []; // pairs: file path, alias path
  const missing = [];
  const used = new Set();
  for (const it of items) {
    const parent = it.isAttachment() && it.parentItem ? it.parentItem : it;
    const att = it.isAttachment() ? it : await parent.getBestAttachment();
    const file = att ? await att.getFilePathAsync() : false;
    if (!file) { missing.push(parent.getField("title") || parent.key); continue; }

    const year = (parent.getField("date", true, true) || "").substring(0, 4);
    let name = [parent.firstCreator, year, parent.getField("title")]
      .filter(Boolean).join(" - ").substring(0, 150) || parent.key;
    name = Zotero.File.getValidFileName(name);
    // Avoid two aliases with the same name
    let unique = name, n = 2;
    while (used.has(unique)) unique = `${name} (${n++})`;
    used.add(unique);
    args.push(file, PathUtils.join(dir, unique));
  }

  if (args.length) {
    // Create Finder aliases and put them on the clipboard
    const jxa = `function run(argv) {
      ObjC.import("AppKit");
      const urls = [];
      for (let i = 0; i < argv.length; i += 2) {
        const target = $.NSURL.fileURLWithPath(argv[i]);
        const alias = $.NSURL.fileURLWithPath(argv[i + 1]);
        const data = target.bookmarkDataWithOptionsIncludingResourceValuesForKeysRelativeToURLError(1024, $(), $(), null);
        if (!data || data.isNil()) throw new Error("Could not create alias data for " + argv[i]);
        if (!$.NSURL.writeBookmarkDataToURLOptionsError(data, alias, 1024, null))
          throw new Error("Could not write alias " + argv[i + 1]);
        urls.push(alias);
      }
      const pb = $.NSPasteboard.generalPasteboard;
      pb.clearContents;
      if (!pb.writeObjects($(urls))) throw new Error("Could not write to the clipboard");
    }`;
    await Zotero.Utilities.Internal.exec("/usr/bin/osascript",
      ["-l", "JavaScript", "-e", jxa, ...args]);
  }

  // Short notification in the bottom corner of Zotero
  const fr = (Zotero.locale || "").startsWith("fr");
  const count = args.length / 2;
  const pw = new Zotero.ProgressWindow({ closeOnClick: true });
  pw.changeHeadline("Finder Shortcut", pluginRootURI + "content/icons/icon@48.png");
  if (count) {
    pw.addDescription(fr
      ? `${count} raccourci${count > 1 ? "s" : ""} copié${count > 1 ? "s" : ""} — collez avec ⌘V dans le Finder.`
      : `${count} shortcut${count > 1 ? "s" : ""} copied — paste with ⌘V in Finder.`);
  }
  if (missing.length) {
    pw.addDescription((fr ? "Aucun fichier pour : " : "No file for: ") + missing.join(", "));
  }
  pw.show();
  pw.startCloseTimer(missing.length ? 6000 : 2500);
}
