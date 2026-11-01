// ==UserScript==
// @name           Luminoctis: LumiNotes capture
// @description    Выделенный на странице текст → ПКМ → «В LumiNotes» → доска: карточка с текстом и строкой-источником (заголовок и адрес страницы).
// ==/UserScript==

// Пишет те же файлы досок, что Home (home/notes-md.mjs + home/store.js); открытая Home перечитывает доски по уведомлению.
(() => {
  const { pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const notes = ChromeUtils.importESModule(pageUrl("home/notes-md.mjs"));

  // карточка: выделенный текст + «— [заголовок](адрес)»
  async function add(board, text, title = "", url = "") {
    let body = text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) return false;
    if (/^https?:/.test(url)) body += `\n— [${(title || url).replace(/[\[\]\n]/g, " ").trim()}](${url.replace(/[ )]/g, encodeURIComponent)})`;
    // задача или заметка — как в настройке «Новые пункты в заметках»
    await notes.addItem(board, { text: body, check: Services.prefs.getStringPref("luminoctis.home.notes.new", "task") == "note" ? null : false });
    return true;
  }

  const menu = document.createXULElement("menu");
  menu.id = "lumi-notes-capture";
  menu.setAttribute("label", "В LumiNotes");
  const popup = document.createXULElement("menupopup");
  menu.append(popup);

  UC_API.Windows.waitWindowLoading(window).then(() => {
    const ctx = document.getElementById("contentAreaContextMenu");
    if (!ctx) return;
    (document.getElementById("context-copy") ?? ctx.firstChild).after(menu);
    ctx.addEventListener("popupshowing", e => {
      if (e.target == ctx) menu.hidden = !gContextMenu?.isTextSelected;
    });
    popup.addEventListener("popupshowing", async e => {
      if (e.target != popup) return;
      const cm = gContextMenu;
      const text = cm?.selectionInfo?.fullText || cm?.textSelected || "";
      const title = cm?.browser?.contentTitle ?? "", url = cm?.contentData?.docLocation || cm?.browser?.currentURI?.spec || "";
      let names;
      try { names = await notes.boardNames(); } catch (err) { names = []; console.error("LumiNotes:", err); }
      popup.replaceChildren(...names.map(name => {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", name);
        item.addEventListener("command", () => add(name, text, title, url).catch(err => {
          console.error("LumiNotes:", err);
          Services.prompt.alert(window, "LumiNotes", `Не удалось добавить заметку в «${name}»: ${err.message}`);
        }));
        return item;
      }));
      if (!names.length) {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", "Не удалось прочитать доски");
        item.setAttribute("disabled", "true");
        popup.append(item);
      }
    });
  });

  window.lumiNotesCapture = { add, menu };
})();
