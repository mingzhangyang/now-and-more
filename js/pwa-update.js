/* Keep updates opt-in, including for installed standalone windows. */
(function () {
  "use strict";

  function watchUpdates(sw, page, render) {
    let registration, candidate, dismissed, timer;
    let applying = false, failed = false, reloading = false, checking = false;
    const tracked = new WeakSet();
    const win = page.window, doc = page.document;
    function publish() {
      render({ ready: !!candidate && candidate !== dismissed, applying, failed });
    }
    function stopApplying() {
      win.clearTimeout(timer);
      applying = false;
    }
    function reload() {
      if (reloading) return;
      reloading = true;
      stopApplying();
      win.location.reload();
    }
    function track(worker) {
      if (!worker || tracked.has(worker)) return;
      tracked.add(worker);
      function inspect() {
        if (worker.state === "installed" && sw.controller && worker !== sw.controller) {
          if (candidate !== worker) {
            candidate = worker;
            failed = false;
            publish();
          }
        } else if (worker.state === "redundant" && candidate === worker) {
          candidate = null;
          stopApplying();
          failed = false;
          publish();
          track(registration.waiting);
        }
      }
      worker.addEventListener("statechange", inspect);
      inspect();
    }
    function check() {
      if (!registration || checking || doc.visibilityState !== "visible") return;
      checking = true;
      Promise.resolve().then(() => registration.update()).catch(() => {}).finally(() => {
        checking = false;
      });
    }
    sw.addEventListener("controllerchange", () => {
      // First install, or an update activated by another window, must not
      // interrupt the user. Reload only after this window requested it.
      if (applying && sw.controller) reload();
    });
    async function register() {
      try {
        registration = await sw.register("/sw.js", { updateViaCache: "none" });
        if (!registration) return;
        registration.addEventListener("updatefound", () => track(registration.installing));
        track(registration.waiting);
        track(registration.installing);
        doc.addEventListener("visibilitychange", check);
        win.addEventListener("pageshow", check);
        win.addEventListener("online", check);
        // A clock PWA may stay open for days without a navigation.
        win.setInterval(check, 15 * 60 * 1000);
        check();
      } catch (e) { /* Service Worker unavailable: the app remains usable. */ }
    }
    if (doc.readyState === "complete") void register();
    else win.addEventListener("load", register, { once: true });
    return {
      later() {
        if (applying) return;
        dismissed = candidate;
        publish();
      },
      apply() {
        if (!candidate || candidate === dismissed || applying || reloading) return;
        if (sw.controller === candidate) { reload(); return; }
        if (!["installed", "activating", "activated"].includes(candidate.state)) return;
        applying = true;
        failed = false;
        publish();
        const retry = () => {
          stopApplying();
          failed = true;
          publish();
        };
        timer = win.setTimeout(retry, 15000);
        try {
          if (candidate.state === "installed") candidate.postMessage({ type: "SKIP_WAITING" });
        } catch (e) { retry(); }
      },
    };
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { watchUpdates };
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  const notice = document.createElement("aside");
  notice.className = "pwa-update";
  notice.hidden = true;
  const message = document.createElement("span");
  message.setAttribute("role", "status");
  const update = document.createElement("button");
  const later = document.createElement("button");
  update.type = later.type = "button";
  update.className = "pwa-update-primary";
  notice.append(message, update, later);
  document.body.appendChild(notice);
  let state = { ready: false, applying: false, failed: false };
  function render(next) {
    state = next;
    const en = document.documentElement.lang.toLowerCase().startsWith("en");
    const copy = en
      ? ["A new version is ready", "Update now", "Later", "Updating…", "Update not finished. Try again."]
      : ["新版本已就绪", "立即更新", "稍后", "正在更新…", "更新未完成，请重试"];
    message.textContent = copy[state.applying ? 3 : state.failed ? 4 : 0];
    update.textContent = copy[1];
    later.textContent = copy[2];
    update.disabled = later.disabled = state.applying;
    notice.hidden = !state.ready;
  }
  const controls = watchUpdates(navigator.serviceWorker, { window, document }, render);
  update.addEventListener("click", controls.apply);
  later.addEventListener("click", controls.later);
  new MutationObserver(() => render(state)).observe(document.documentElement, {
    attributes: true, attributeFilter: ["lang"],
  });
  render(state);
})();
