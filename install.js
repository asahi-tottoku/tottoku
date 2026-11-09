// 「ホーム画面に追加」の案内。ホーム画面から開いていないときだけ、上に小さく出す。
// iPhone はホーム画面に追加しないと、しばらく使わないとブラウザがデータを消すことがあるので、特に勧める。
(function () {
  const bar = document.getElementById("installBar");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let closed = false;
  try { closed = localStorage.getItem("tottoku-install-closed") === "1"; } catch (e) { /* なくてよい */ }
  if (standalone || closed || !bar) return;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function show(html, onAdd) {
    bar.innerHTML = `<span>${html}</span>`;
    if (onAdd) {
      const b = document.createElement("button");
      b.textContent = "追加する";
      b.onclick = onAdd;
      bar.appendChild(b);
    }
    const x = document.createElement("button");
    x.textContent = "×"; x.setAttribute("aria-label", "閉じる"); x.className = "bar-close";
    x.onclick = () => {
      bar.hidden = true;
      try { localStorage.setItem("tottoku-install-closed", "1"); } catch (e) { /* なくてよい */ }
    };
    bar.appendChild(x);
    bar.hidden = false;
  }

  if (isIOS) {
    show("📲 Safariの「共有」<b>⬆︎</b> →「ホーム画面に追加」で、アプリのように使えます。データも消えにくくなります。");
    return;
  }
  // Android の Chrome: ホーム画面に追加すると、共有メニューに「とっとく」が出る
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    show("📲 ホーム画面に追加すると、他のアプリの「共有」から直接保存できます。", async () => {
      e.prompt();
      try { await e.userChoice; } catch (err) { /* やめた */ }
      bar.hidden = true;
    });
  });
})();
