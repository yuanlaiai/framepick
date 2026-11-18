/* 文案提取器 · 前端交互 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    taskId: null,
    pollTimer: null,
    result: null,
    view: "text",
    settings: null,
    maxBytes: 600 * 1024 * 1024,
    lastUrl: "",
    uploadXhr: null,
    toastTimer: null,
    busy: false,
  };

  const STAGE_STEPS = [
    ["解析链接"],
    ["获取字幕", "下载视频", "下载音频", "提取音频", "生成封面", "处理音频"],
    ["语音识别"],
    ["整理文案", "完成"],
  ];

  /* ---------------- 基础工具 ---------------- */
  class ApiError extends Error {
    constructor(message, hint, status) {
      super(message);
      this.hint = hint || "";
      this.status = status || 0;
    }
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const detail = data && data.detail;
      if (detail && typeof detail === "object") {
        throw new ApiError(detail.message || "请求失败", detail.hint || "", res.status);
      }
      throw new ApiError(typeof detail === "string" ? detail : `请求失败（${res.status}）`, "", res.status);
    }
    return data;
  }

  function toast(message, duration = 2200) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove("show"), duration);
  }

  function fmtDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function fmtTime(ts) {
    return new Date((ts || 0) * 1000).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtRelative(ts) {
    const diff = Date.now() / 1000 - (ts || 0);
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return "今天 " + fmtTime(ts);
    if (diff < 172800) return "昨天 " + fmtTime(ts);
    return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }

  function fmtTimestamp(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function prettyEngine(engine) {
    if (!engine) return "";
    if (engine === "platform-subtitles") return "平台字幕";
    const m = /^whisper-(.+)$/.exec(engine);
    return m ? `Whisper ${m[1]}` : engine;
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (fromUrl === "dark" || fromUrl === "light") {
      document.documentElement.dataset.theme = fromUrl;
      return;
    }
    const saved = localStorage.getItem("vids:theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = saved || (prefersDark ? "dark" : "light");
    $("#themeBtn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("vids:theme", next);
    });
  }

  /* ---------------- 设置 ---------------- */
  function optionValue(key, fallback) {
    const saved = localStorage.getItem(`vids:${key}`);
    return saved || fallback;
  }

  function currentOptions() {
    return {
      model: $("#modelSelect").value || "standard",
      language: $("#langSelect").value || "auto",
      prefer_subtitles: $("#preferSubs").checked,
      download_media: $("#downloadMedia").checked,
      quality: $("#qualitySelect").value || "720",
    };
  }

  function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }

  function fmtCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`;
    if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
    return String(n);
  }

  async function loadSettings() {
    try {
      const settings = await api("/api/settings");
      state.settings = settings;
      state.maxBytes = (settings.max_upload_mb || 600) * 1024 * 1024;

      const modelSelect = $("#modelSelect");
      modelSelect.innerHTML = "";
      (settings.models || []).forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = `${item.label} · ${item.hint.split("·")[1] ? item.hint.split("·")[1].trim() : item.hint}`;
        modelSelect.appendChild(opt);
      });
      modelSelect.value = optionValue("model", settings.defaults?.model || "standard");

      const langSelect = $("#langSelect");
      langSelect.innerHTML = "";
      (settings.languages || []).forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = item.label;
        langSelect.appendChild(opt);
      });
      langSelect.value = optionValue("language", settings.defaults?.language || "auto");

      const qualitySelect = $("#qualitySelect");
      qualitySelect.innerHTML = "";
      (settings.qualities || []).forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = item.label;
        qualitySelect.appendChild(opt);
      });
      qualitySelect.value = optionValue("quality", "720");

      const prefer = localStorage.getItem("vids:preferSubs");
      $("#preferSubs").checked = prefer === null ? Boolean(settings.defaults?.prefer_subtitles) : prefer === "1";
      const withMedia = localStorage.getItem("vids:downloadMedia");
      $("#downloadMedia").checked = withMedia === null ? true : withMedia === "1";

      $("#maxUpload").textContent = settings.max_upload_mb || 600;
      $("#envDevice").textContent = `${settings.device?.device || "-"} / ${settings.device?.compute_type || "-"}`;
      $("#envFfmpeg").textContent = settings.ffmpeg === false ? "未安装" : "可用";
      $("#envUpload").textContent = `${settings.max_upload_mb || 600} MB`;
      $("#envVersion").textContent = "v" + (settings.version || "1.0.0");
      $("#deviceInfo").textContent = `faster-whisper · ${settings.device?.device || "cpu"}`;
      renderCookieStatus(settings.has_cookies, settings.cookies_updated_at);
    } catch (err) {
      console.warn("加载设置失败", err);
    }

    ["modelSelect", "langSelect", "qualitySelect"].forEach((id) => {
      $(`#${id}`).addEventListener("change", () => {
        const key = id === "modelSelect" ? "model" : id === "langSelect" ? "language" : "quality";
        localStorage.setItem(`vids:${key}`, $(`#${id}`).value);
      });
    });
    $("#preferSubs").addEventListener("change", () => {
      localStorage.setItem("vids:preferSubs", $("#preferSubs").checked ? "1" : "0");
    });
    $("#downloadMedia").addEventListener("change", () => {
      localStorage.setItem("vids:downloadMedia", $("#downloadMedia").checked ? "1" : "0");
    });
  }

  function renderCookieStatus(hasCookies, updatedAt) {
    const pill = $("#cookieStatus");
    if (hasCookies) {
      pill.textContent = updatedAt ? `已导入 · ${fmtRelative(updatedAt)}` : "已导入";
      pill.classList.add("on");
    } else {
      pill.textContent = "未导入";
      pill.classList.remove("on");
    }
  }

  /* ---------------- 界面切换 ---------------- */
  function switchTab(tab) {
    $$(".tab").forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    $("#pane-url").hidden = tab !== "url";
    $("#pane-file").hidden = tab !== "file";
    if (tab === "url") $("#urlInput").focus();
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function setBusy(busy) {
    state.busy = busy;
    $("#submitBtn").disabled = busy;
    $("#submitBtn").querySelector("span").textContent = busy ? "提取中…" : "开始提取";
  }

  function hidePanels(except) {
    ["progressPanel", "errorPanel", "resultPanel"].forEach((id) => {
      if (id !== except) $(`#${id}`).hidden = true;
    });
    if (except !== "resultPanel") {
      const player = $("#videoPlayer");
      if (player) player.pause();
      const audio = $("#audioPlayer");
      if (audio) audio.pause();
    }
  }

  function resetProgress() {
    $("#barFill").style.width = "0%";
    $("#pctText").textContent = "0%";
    $("#stageText").textContent = "准备中";
    $("#messageText").textContent = "任务已提交，等待处理…";
    $("#queueNote").textContent = "";
    $("#spinner").style.display = "";
    $$("#steps li").forEach((li) => li.classList.remove("active", "done"));
  }

  function stepIndex(stage) {
    for (let i = 0; i < STAGE_STEPS.length; i += 1) {
      if (STAGE_STEPS[i].some((name) => stage && stage.includes(name))) return i;
    }
    return -1;
  }

  function renderProgress(task) {
    const pct = Math.max(0, Math.min(100, Number(task.progress) || 0));
    $("#barFill").style.width = pct + "%";
    $("#pctText").textContent = pct + "%";
    $("#stageText").textContent =
      task.status === "queued" ? "排队中" : task.stage || "处理中";
    $("#messageText").textContent = task.message || "";
    $("#queueNote").textContent =
      task.status === "queued" ? "正在处理其他任务，马上轮到你…" : "";

    const idx = stepIndex(task.stage);
    $$("#steps li").forEach((li) => {
      const i = Number(li.dataset.step);
      li.classList.toggle("done", idx >= 0 && i < idx);
      li.classList.toggle("active", idx >= 0 && i === idx);
    });
  }

  function showProgress() {
    hidePanels("progressPanel");
    $("#progressPanel").hidden = false;
    resetProgress();
    $("#progressPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showError(title, hint) {
    hidePanels("errorPanel");
    $("#errorPanel").hidden = false;
    $("#errorTitle").textContent = title || "提取失败";
    $("#errorHint").textContent = hint || "";
    $("#errorPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------------- 任务提交 ---------------- */
  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function poll(taskId) {
    stopPolling();
    const tick = async () => {
      try {
        const task = await api(`/api/tasks/${taskId}`);
        renderProgress(task);
        if (task.status === "done") {
          stopPolling();
          setBusy(false);
          renderResult(task.result);
          refreshRecent();
        } else if (task.status === "error") {
          stopPolling();
          setBusy(false);
          showError(task.error, task.error_hint);
          refreshRecent();
        } else if (task.status === "canceled") {
          stopPolling();
          setBusy(false);
          hidePanels();
          toast("任务已取消");
          refreshRecent();
        }
      } catch (err) {
        stopPolling();
        setBusy(false);
        showError("任务状态读取失败", err.message || "");
      }
    };
    await tick();
    state.pollTimer = setInterval(tick, 900);
  }

  async function submitUrl(value) {
    if (state.busy) return;
    const text = (value ?? $("#urlInput").value).trim();
    if (!text) {
      toast("先粘贴一个视频链接吧");
      $("#urlInput").focus();
      return;
    }
    state.lastUrl = text;
    hidePanels("progressPanel");
    setBusy(true);
    showProgress();
    $("#stageText").textContent = "提交任务";
    $("#messageText").textContent = "正在创建提取任务…";
    try {
      const data = await api("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: text, ...currentOptions() }),
      });
      state.taskId = data.id;
      $("#queueNote").textContent = "";
      toast("任务已开始");
      await poll(data.id);
    } catch (err) {
      setBusy(false);
      showError(err.message, err.hint);
    }
  }

  function uploadFile(file) {
    if (!file || state.busy) return;
    if (file.size > state.maxBytes) {
      showError(
        "文件太大",
        `当前上限 ${Math.round(state.maxBytes / 1048576)} MB，可以先压缩或截取需要的片段。`
      );
      return;
    }
    state.lastUrl = "";
    hidePanels("progressPanel");
    setBusy(true);
    showProgress();
    $("#stageText").textContent = "上传文件";
    $("#messageText").textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
    $("#barFill").style.width = "4%";
    $("#pctText").textContent = "0%";

    const form = new FormData();
    form.append("file", file);
    const opts = currentOptions();
    form.append("model", opts.model);
    form.append("language", opts.language);
    form.append("prefer_subtitles", String(opts.prefer_subtitles));
    form.append("download_media", String(opts.download_media));
    form.append("quality", opts.quality);

    const xhr = new XMLHttpRequest();
    state.uploadXhr = xhr;
    xhr.open("POST", "/api/tasks/upload");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      $("#barFill").style.width = Math.max(4, Math.round(pct * 0.08)) + "%";
      $("#pctText").textContent = pct + "%";
      $("#messageText").textContent = `正在上传 ${pct}% · ${(event.loaded / 1048576).toFixed(1)} MB`;
    };
    xhr.onload = () => {
      state.uploadXhr = null;
      let data = null;
      try {
        data = JSON.parse(xhr.responseText || "null");
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.id) {
        state.taskId = data.id;
        poll(data.id);
      } else {
        setBusy(false);
        const detail = data && data.detail;
        showError(
          (detail && detail.message) || "上传失败",
          (detail && detail.hint) || `服务器返回 ${xhr.status}`
        );
      }
    };
    xhr.onerror = () => {
      state.uploadXhr = null;
      setBusy(false);
      showError("上传失败", "网络中断，请重试。");
    };
    xhr.send(form);
  }

  async function cancelTask() {
    if (state.uploadXhr) {
      state.uploadXhr.abort();
      state.uploadXhr = null;
      setBusy(false);
      hidePanels();
      toast("已取消上传");
      return;
    }
    if (!state.taskId) return;
    try {
      await api(`/api/tasks/${state.taskId}/cancel`, { method: "POST" });
      toast("已发送取消请求");
    } catch (err) {
      toast(err.message || "取消失败");
    }
  }

  /* ---------------- 结果渲染 ---------------- */
  function renderResult(result, { scroll = true } = {}) {
    if (!result) {
      showError("结果为空", "没有拿到转写内容，请重试。");
      return;
    }
    state.result = result;
    state.view = "text";
    $$("#viewTabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === "text"));
    hidePanels("resultPanel");
    $("#resultPanel").hidden = false;

    const source = result.source || {};
    const thumbWrap = $("#thumbWrap");
    const img = $("#thumb");
    thumbWrap.classList.remove("has-img");
    img.hidden = true;
    img.removeAttribute("src");
    if (source.thumbnail) {
      img.hidden = false;
      img.onload = () => {
        thumbWrap.classList.add("has-img");
      };
      img.onerror = () => {
        img.hidden = true;
        thumbWrap.classList.remove("has-img");
      };
      img.src = source.thumbnail;
      img.alt = source.title || "";
    }

    $("#platformBadge").textContent = source.platform_label || (result.kind === "file" ? "本地文件" : "视频");
    $("#thumbWrap").setAttribute("data-label", result.kind === "file" ? "本地文件" : "视频");
    $("#engineBadge").textContent = prettyEngine(result.engine);
    $("#engineBadge").hidden = !result.engine;
    $("#resultTitle").textContent = source.title || "视频文案";

    const meta = $("#resultMeta");
    meta.innerHTML = "";
    const addMeta = (text, href) => {
      if (!text) return;
      const span = document.createElement("span");
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.textContent = text;
        span.appendChild(a);
      } else {
        span.textContent = text;
      }
      meta.appendChild(span);
    };
    addMeta(source.uploader);
    addMeta(source.upload_date);
    addMeta(source.duration ? fmtDuration(source.duration) : "");
    if (source.url) addMeta("查看原视频", source.url);
    meta.hidden = meta.children.length === 0;

    renderMedia(result);
    renderCaption(result);
    renderInfo(result);

    const stats = result.stats || {};
    const statItems = [
      [Number(stats.chars || 0).toLocaleString("zh-CN"), "字"],
      [stats.paragraphs || 0, "段"],
      [fmtDuration(stats.duration || 0), "时长"],
      [`${Math.round(result.elapsed || 0)}s`, "处理耗时"],
    ];
    const statsWrap = $("#stats");
    statsWrap.innerHTML = "";
    statItems.forEach(([value, label]) => {
      const div = document.createElement("div");
      div.className = "stat";
      const b = document.createElement("b");
      b.textContent = value;
      const span = document.createElement("span");
      span.textContent = label;
      div.append(b, span);
      statsWrap.appendChild(div);
    });

    $("#timeCost").textContent = `生成于 ${fmtTime(result.created_at || Date.now() / 1000)}`;
    renderContent();
    if (scroll) $("#resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const ASSET_ICONS = {
    video:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="6" width="12.5" height="12" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="m16 10.5 4-2.3v7.6l-4-2.3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    audio:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V6.5l9-2v11" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.8" cy="18" r="2.6" stroke="currentColor" stroke-width="1.7"/><circle cx="15.8" cy="15.5" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>',
    cover:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="8.8" cy="9.6" r="1.7" stroke="currentColor" stroke-width="1.6"/><path d="m5 17 4.5-4.2 3.2 2.8 3-2.4L19 17" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    package:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 8.2 12 12.4l8-4.2M12 12.4V20" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  };

  const DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 18.5h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function renderMedia(result) {
    const assets = result.assets || {};
    const id = result.id || state.taskId;
    const mediaBlock = $("#mediaBlock");
    const videoShell = $("#videoShell");
    const player = $("#videoPlayer");
    const grid = $("#assetGrid");
    grid.innerHTML = "";

    const hasVideo = Boolean(assets.video && id);
    const hasAudio = Boolean(assets.audio && id);
    const hasCover = Boolean(assets.cover && id);
    mediaBlock.hidden = !Object.keys(assets).length;

    if (hasVideo) {
      videoShell.hidden = false;
      if (player.dataset.task !== id) {
        player.dataset.task = id;
        player.poster = assets.cover ? `/api/tasks/${id}/asset/cover` : "";
        player.src = `/api/tasks/${id}/asset/video`;
        player.load();
      }
    } else {
      videoShell.hidden = true;
      player.pause();
      player.removeAttribute("src");
      player.dataset.task = "";
    }

    // 封面：没有视频时作为主视觉直接展示
    const coverHero = $("#coverHero");
    const coverHeroImg = $("#coverHeroImg");
    if (hasCover && !hasVideo) {
      coverHero.hidden = false;
      if (coverHeroImg.dataset.task !== id) {
        coverHeroImg.dataset.task = id;
        coverHeroImg.src = `/api/tasks/${id}/asset/cover`;
      }
    } else {
      coverHero.hidden = true;
      coverHeroImg.removeAttribute("src");
      coverHeroImg.dataset.task = "";
    }

    // 音频：内置播放器 + 封面做专辑图
    const audioBar = $("#audioBar");
    const audioPlayer = $("#audioPlayer");
    const audioArtImg = $("#audioArtImg");
    if (hasAudio) {
      audioBar.hidden = false;
      if (audioPlayer.dataset.task !== id) {
        audioPlayer.dataset.task = id;
        audioPlayer.src = `/api/tasks/${id}/asset/audio`;
        audioPlayer.load();
      }
      $("#audioName").textContent = `音频 · ${assets.audio.ext.toUpperCase()}`;
      $("#audioSize").textContent = fmtSize(assets.audio.size);
      if (hasCover) {
        if (audioArtImg.dataset.task !== id) {
          audioArtImg.dataset.task = id;
          audioArtImg.src = `/api/tasks/${id}/asset/cover`;
        }
        audioArtImg.hidden = false;
      } else {
        audioArtImg.hidden = true;
        audioArtImg.removeAttribute("src");
        audioArtImg.dataset.task = "";
      }
    } else {
      audioBar.hidden = true;
      audioPlayer.pause();
      audioPlayer.removeAttribute("src");
      audioPlayer.dataset.task = "";
    }

    const items = [];
    if (assets.video) items.push({ kind: "video", label: "视频", ext: assets.video.ext.toUpperCase(), size: assets.video.size });
    if (assets.audio) items.push({ kind: "audio", label: "音频", ext: assets.audio.ext.toUpperCase(), size: assets.audio.size });
    if (assets.cover) items.push({ kind: "cover", label: "封面", ext: assets.cover.ext.toUpperCase(), size: assets.cover.size });
    if (items.length) {
      const total = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
      items.push({ kind: "package", label: "全部素材", ext: "ZIP", size: total });
    }

    items.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "asset-card";
      card.dataset.asset = item.kind;

      const icon = document.createElement("span");
      icon.className = "asset-icon";
      icon.innerHTML = ASSET_ICONS[item.kind] || ASSET_ICONS.package;

      const info = document.createElement("span");
      info.className = "asset-info";
      const name = document.createElement("span");
      name.className = "asset-name";
      name.textContent = `${item.label} · ${item.ext}`;
      const size = document.createElement("span");
      size.className = "asset-size";
      size.textContent = item.size ? fmtSize(item.size) : "点击下载";
      info.append(name, size);

      const dl = document.createElement("span");
      dl.className = "asset-dl";
      dl.innerHTML = DOWNLOAD_ICON;

      card.append(icon, info, dl);
      grid.appendChild(card);
    });
  }

  function renderCaption(result) {
    const source = result.source || {};
    const description = String(source.description || "").trim();
    const tags = (source.tags || []).map(String).filter(Boolean);
    const card = $("#captionCard");
    if (!description && !tags.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    $("#captionText").textContent = description || "（平台没有提供发布文案）";
    const row = $("#captionTags");
    row.innerHTML = "";
    tags.forEach((tag) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag.startsWith("#") ? tag : `#${tag}`;
      row.appendChild(span);
    });
  }

  function renderInfo(result) {
    const source = result.source || {};
    const assets = result.assets || {};
    const details = $("#infoDetails");
    const list = $("#infoList");
    list.innerHTML = "";
    const rows = [];
    const add = (label, value) => {
      if (value === null || value === undefined || value === "") return;
      rows.push([label, String(value)]);
    };
    add("平台", source.platform_label);
    add("作者", source.uploader);
    add("发布时间", source.upload_date);
    add("时长", source.duration ? fmtDuration(source.duration) : "");
    if (assets.video && assets.video.width) add("分辨率", `${assets.video.width} × ${assets.video.height}`);
    add("播放", fmtCount(source.view_count));
    add("点赞", fmtCount(source.like_count));
    add("评论", fmtCount(source.comment_count));
    add("转发", fmtCount(source.repost_count));
    add("视频大小", assets.video ? fmtSize(assets.video.size) : "");
    add("音频大小", assets.audio ? fmtSize(assets.audio.size) : "");
    add("转写模型", prettyEngine(result.engine));
    add("识别语言", result.language);

    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      list.appendChild(row);
    });

    if (source.url) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = "原链接";
      const dd = document.createElement("dd");
      const a = document.createElement("a");
      a.href = source.url;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.textContent = source.url;
      dd.appendChild(a);
      row.append(dt, dd);
      list.appendChild(row);
    }

    details.hidden = rows.length === 0 && !source.url;
  }

  function downloadAsset(kind) {
    const id = state.taskId;
    if (!id) return;
    const url = kind === "package" ? `/api/tasks/${id}/package` : `/api/tasks/${id}/asset/${kind}?download=1`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(kind === "package" ? "正在打包全部素材…" : "开始下载");
  }

  function copyCaption() {
    const source = state.result?.source || {};
    const tags = (source.tags || []).map((tag) => (String(tag).startsWith("#") ? tag : `#${tag}`));
    const text = [source.title, source.description, tags.join(" ")]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join("\n\n");
    if (!text) {
      toast("没有可复制的文案");
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast("已复制发布文案")).catch(() => fallbackCopy(text, () => toast("已复制发布文案")));
    } else {
      fallbackCopy(text, () => toast("已复制发布文案"));
    }
  }

  function renderContent() {
    const result = state.result;
    const view = state.view;
    const box = $("#resultContent");
    box.innerHTML = "";
    box.classList.toggle("seg", view === "segments");
    if (!result) return;

    if (view === "text") {
      const paragraphs = result.paragraphs || [];
      if (!paragraphs.length) {
        const p = document.createElement("p");
        p.className = "para";
        p.textContent = result.text || "";
        box.appendChild(p);
        return;
      }
      paragraphs.forEach((item) => {
        const p = document.createElement("p");
        p.className = "para";
        p.textContent = item.text;
        box.appendChild(p);
      });
      return;
    }

    if (view === "timeline") {
      (result.paragraphs || []).forEach((item) => {
        const row = document.createElement("div");
        row.className = "row";
        const t = document.createElement("span");
        t.className = "t";
        t.textContent = fmtTimestamp(item.start);
        const text = document.createElement("span");
        text.textContent = item.text;
        row.append(t, text);
        box.appendChild(row);
      });
      return;
    }

    (result.segments || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = "row";
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = `${fmtTimestamp(item.start)} – ${fmtTimestamp(item.end)}`;
      const text = document.createElement("span");
      text.textContent = item.text;
      row.append(t, text);
      box.appendChild(row);
    });
  }

  function copyText() {
    const text = state.result?.text || "";
    if (!text) return;
    const done = () => {
      toast("已复制全文");
      const label = $("#copyBtn span");
      const old = label.textContent;
      label.textContent = "已复制 ✓";
      setTimeout(() => (label.textContent = old), 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast("复制失败，请手动选择文本");
    }
    area.remove();
  }

  function download(format) {
    if (!state.taskId || !state.result) return;
    const a = document.createElement("a");
    a.href = `/api/tasks/${state.taskId}/file?format=${encodeURIComponent(format)}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("已开始下载");
  }

  async function deleteCurrent() {
    if (!state.taskId) return;
    if (!window.confirm("删除这条提取记录？对应的文案和缓存会一起清除。")) return;
    try {
      await api(`/api/tasks/${state.taskId}`, { method: "DELETE" });
      state.taskId = null;
      state.result = null;
      hidePanels();
      toast("已删除");
      refreshRecent();
    } catch (err) {
      toast(err.message || "删除失败");
    }
  }

  /* ---------------- 最近记录 ---------------- */
  async function refreshRecent() {
    try {
      const data = await api("/api/tasks?limit=8");
      const list = $("#recentList");
      list.innerHTML = "";
      const tasks = (data.tasks || []).filter((t) => t.status === "done" || t.status === "running" || t.status === "error");
      $("#recentNote").textContent = tasks.length ? `共 ${data.tasks.length} 条` : "";
      if (!tasks.length) {
        const empty = document.createElement("p");
        empty.className = "rc-empty";
        empty.textContent = "还没有记录。粘贴一个链接，或者点上面的示例视频试试。";
        list.appendChild(empty);
        return;
      }
      tasks.slice(0, 8).forEach((task) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "recent-card";
        const top = document.createElement("div");
        top.className = "rc-top";
        const platform = document.createElement("span");
        platform.textContent = task.platform_label || (task.kind === "file" ? "本地文件" : "视频");
        const time = document.createElement("span");
        time.textContent = fmtRelative(task.created_at);
        top.append(platform, time);
        const title = document.createElement("div");
        title.className = "rc-title";
        title.textContent = task.title || "未命名任务";
        const meta = document.createElement("div");
        meta.className = "rc-meta";
        const statsBits = [];
        if (task.chars) statsBits.push(`${Number(task.chars).toLocaleString("zh-CN")} 字`);
        if (task.duration) statsBits.push(fmtDuration(task.duration));
        if (task.status === "error") statsBits.push("失败");
        if (task.status === "running") statsBits.push("处理中");
        statsBits.forEach((text) => {
          const span = document.createElement("span");
          span.textContent = text;
          meta.appendChild(span);
        });
        card.append(top, title, meta);
        card.addEventListener("click", () => openRecent(task.id));
        list.appendChild(card);
      });
    } catch (err) {
      console.warn("加载最近记录失败", err);
    }
  }

  async function openRecent(taskId, { scroll = true } = {}) {
    try {
      const task = await api(`/api/tasks/${taskId}`);
      if (task.status === "done" && task.result) {
        state.taskId = task.id;
        renderResult(task.result, { scroll });
        if (!new URLSearchParams(window.location.search).get("task")) {
          history.replaceState(null, "", `?task=${task.id}`);
        }
      } else if (task.status === "running" || task.status === "queued") {
        state.taskId = task.id;
        setBusy(true);
        showProgress();
        poll(task.id);
      } else {
        state.taskId = task.id;
        showError(task.error || "任务失败", task.error_hint || "");
      }
    } catch (err) {
      toast(err.message || "打开失败");
    }
  }

  /* ---------------- 设置弹窗 ---------------- */
  async function openSettings() {
    const dialog = $("#settingsDialog");
    renderCookieStatus(state.settings?.has_cookies, state.settings?.cookies_updated_at);
    try {
      const fresh = await api("/api/settings");
      state.settings = fresh;
      renderCookieStatus(fresh.has_cookies, fresh.cookies_updated_at);
    } catch {
      /* 忽略 */
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeSettings() {
    const dialog = $("#settingsDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  async function saveCookies() {
    const text = $("#cookiesInput").value.trim();
    if (!text) {
      toast("先粘贴 cookies 内容");
      return;
    }
    try {
      const data = await api("/api/settings/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      $("#cookiesInput").value = "";
      toast(`已保存 ${data.lines} 行 cookies`);
      await loadSettings();
    } catch (err) {
      toast(err.message || "保存失败");
    }
  }

  async function clearCookies() {
    try {
      await api("/api/settings/cookies", { method: "DELETE" });
      toast("已清除 cookies");
      await loadSettings();
    } catch (err) {
      toast(err.message || "清除失败");
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    const input = $("#urlInput");
    input.addEventListener("input", () => autoGrow(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitUrl();
      }
    });

    $("#submitBtn").addEventListener("click", () => submitUrl());
    $("#sampleBtn").addEventListener("click", () => {
      input.value = "https://www.bilibili.com/video/BV1GJ411x7h7";
      autoGrow(input);
      input.focus();
      toast("已填入示例链接，点击开始提取");
    });

    $("#cancelBtn").addEventListener("click", cancelTask);
    $("#retryBtn").addEventListener("click", () => {
      if (state.lastUrl) submitUrl(state.lastUrl);
      else $("#urlInput").focus();
    });

    $("#viewTabs").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-view]");
      if (!btn) return;
      state.view = btn.dataset.view;
      $$("#viewTabs button").forEach((b) => b.classList.toggle("active", b === btn));
      renderContent();
    });

    $("#copyBtn").addEventListener("click", copyText);
    $("#copyCaption").addEventListener("click", copyCaption);
    $("#assetGrid").addEventListener("click", (event) => {
      const card = event.target.closest(".asset-card");
      if (card) downloadAsset(card.dataset.asset);
    });
    $("#audioArtImg").addEventListener("error", () => {
      $("#audioArtImg").hidden = true;
    });
    $("#videoPlayer").addEventListener("error", () => {
      if (!$("#videoPlayer").getAttribute("src")) return;
      $("#videoShell").hidden = true;
      toast("浏览器无法预览该视频编码，可直接下载观看");
    });
    $$("[data-download]").forEach((btn) => {
      btn.addEventListener("click", () => download(btn.dataset.download));
    });
    $("#deleteBtn").addEventListener("click", deleteCurrent);

    const dropzone = $("#dropzone");
    const fileInput = $("#fileInput");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) uploadFile(file);
      fileInput.value = "";
    });
    ["dragenter", "dragover"].forEach((name) => {
      dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragover");
      });
    });
    dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadFile(file);
    });

    $("#settingsBtn").addEventListener("click", openSettings);
    $("#closeSettings").addEventListener("click", closeSettings);
    $("#saveCookies").addEventListener("click", saveCookies);
    $("#clearCookies").addEventListener("click", clearCookies);
    $("#settingsDialog").addEventListener("click", (event) => {
      if (event.target === $("#settingsDialog")) closeSettings();
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submitUrl();
      }
    });
  }

  function init() {
    initTheme();
    bindEvents();
    loadSettings();
    refreshRecent();
    const input = $("#urlInput");
    input.focus({ preventScroll: true });

    const shared = new URLSearchParams(window.location.search).get("task");
    if (shared) openRecent(shared, { scroll: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
