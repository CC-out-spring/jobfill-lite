(() => {
  const ROOT_ID = "jobfill-root";
  const DATA_EVENT = "jobfill:resume-data";
  const EDITABLE_SELECTOR =
    'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]), [contenteditable="true"]';

  const state = {
    search: "",
    privacy: false,
    editMode: false,
    minimized: false,
    lastFocused: null
  };

  let resumeData = [];
  let root;
  let panel;
  let body;
  let searchInput;
  let statusEl;
  let previewBtn;
  let editBtn;
  let saveTimer = null;

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function makeId() {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `jobfill-${Date.now()}-${Math.random()}`;
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return [value];
  }

  function normalizeData(raw) {
    const groups = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.groups)
      ? raw.groups
      : Array.isArray(raw?.data)
      ? raw.data
      : [];

    return groups
      .map((group) => {
        const name = normalizeText(group?.group ?? group?.name ?? "未命名");
        const items = toArray(group?.items ?? group?.fields ?? []).map((item) => ({
          id: item?.id || makeId(),
          group: name,
          label: normalizeText(item?.label ?? item?.name ?? item?.key ?? "字段"),
          value: item?.value ?? item?.text ?? ""
        }));
        return { group: name, items: items.filter((item) => item.label || item.value) };
      })
      .filter((group) => group.items.length > 0);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function editable(el) {
    return !!el && (el.matches?.(EDITABLE_SELECTOR) || el.isContentEditable);
  }

  function inPanel(el) {
    return !!root && !!el?.closest && root.contains(el.closest(`#${ROOT_ID}`) || el);
  }

  function rememberFocus(target) {
    if (inPanel(target)) {
      return;
    }
    if (editable(target)) {
      state.lastFocused = target;
    }
  }

  function getTargetElement() {
    if (state.lastFocused && state.lastFocused.isConnected && visible(state.lastFocused)) {
      return state.lastFocused;
    }
    const active = document.activeElement;
    if (!inPanel(active) && editable(active) && visible(active)) {
      return active;
    }
    return [...document.querySelectorAll(EDITABLE_SELECTOR)].find((el) => !inPanel(el) && visible(el)) || null;
  }

  function getFocusableElements() {
    return [...document.querySelectorAll(EDITABLE_SELECTOR)].filter((el) => !inPanel(el) && visible(el));
  }

  function cloneData(data) {
    return normalizeData(JSON.parse(JSON.stringify(data)));
  }

  function saveData(message = "已保存") {
    return new Promise((resolve) => {
      chrome.storage.local.set({ jobfillData: resumeData }, () => {
        statusEl.textContent = chrome.runtime.lastError ? "保存失败" : message;
        resolve();
      });
    });
  }

  function scheduleSave(message = "已自动保存") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveData(message);
    }, 350);
  }

  function loadSavedData(defaultData) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["jobfillData"], (result) => {
        const saved = normalizeData(result?.jobfillData);
        resolve(saved.length ? saved : defaultData);
      });
    });
  }

  function exportData() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: resumeData
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jobfill-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = "已导出备份";
  }

  function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result || "{}"));
          const imported = normalizeData(parsed.data || parsed.groups || parsed);
          if (!imported.length) {
            statusEl.textContent = "导入失败：没有字段";
            return;
          }
          resumeData = imported;
          await saveData("已导入并保存");
          renderItems();
        } catch {
          statusEl.textContent = "导入失败：JSON 格式不对";
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }

  function flash(el) {
    if (!el) return;
    const previous = el.style.outline;
    el.style.outline = "2px solid #2563eb";
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      el.style.outline = previous;
      el.style.outlineOffset = "";
    }, 700);
  }

  function fillElement(el, value) {
    if (!el) return false;
    const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");

    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const lowered = normalizeText(text).toLowerCase();
      const checked = !["", "0", "false", "no", "off", "否", "未选", "不"].includes(lowered);
      el.checked = checked;
      fire(el, "input");
      fire(el, "change");
      flash(el);
      return true;
    }

    if (el.tagName === "SELECT") {
      const target = normalizeText(text).toLowerCase();
      const options = [...el.options];
      const matched =
        options.find((option) => {
          const candidate = normalizeText(option.value || option.textContent).toLowerCase();
          return candidate === target;
        }) ||
        options.find((option) => {
          const candidate = normalizeText(option.value || option.textContent).toLowerCase();
          return target && candidate.includes(target);
        });

      if (!matched) {
        return false;
      }

      el.value = matched.value;
      fire(el, "input");
      fire(el, "change");
      flash(el);
      return true;
    }

    if (el.isContentEditable) {
      el.focus();
      el.textContent = text;
      fire(el, "input");
      fire(el, "change");
      flash(el);
      return true;
    }

    if ("value" in el) {
      el.focus();
      setNativeValue(el, text);
      fire(el, "input");
      fire(el, "change");
      fire(el, "blur");
      flash(el);
      return true;
    }

    return false;
  }

  function itemMatches(item, query) {
    if (!query) return true;
    const haystack = [item.label, item.value, item.group].map((part) => normalizeText(part).toLowerCase());
    return haystack.some((part) => part.includes(query));
  }

  function renderItems() {
    body.innerHTML = "";
    const query = normalizeText(state.search).toLowerCase();
    let count = 0;

    if (state.editMode) {
      renderEditor(query);
      return;
    }

    resumeData.forEach((group) => {
      const items = group.items.filter((item) => itemMatches(item, query));
      if (!items.length) return;
      count += items.length;

      const details = document.createElement("details");
      details.className = "jobfill-group";
      details.open = true;

      const summary = document.createElement("summary");
      summary.innerHTML = `<span>${escapeHtml(group.group)}</span><span class="jobfill-group-count">${items.length}</span>`;

      const grid = document.createElement("div");
      grid.className = "jobfill-grid";

      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "jobfill-item";
        button.innerHTML = `
          <strong>${escapeHtml(item.label)}</strong>
          <span>${state.privacy ? "已隐藏" : escapeHtml(previewValue(item.value))}</span>
        `;
        button.addEventListener("click", () => {
          const target = getTargetElement();
          const filled = fillElement(target, item.value);
          statusEl.textContent = filled ? `已填入：${item.label}` : "先点一下页面上的输入框";
        });
        grid.appendChild(button);
      });

      details.appendChild(summary);
      details.appendChild(grid);
      body.appendChild(details);
    });

    if (!count) {
      const empty = document.createElement("div");
      empty.className = "jobfill-empty";
      empty.textContent = "没有匹配项";
      body.appendChild(empty);
    }

    statusEl.textContent = `${count} 个字段`;
    previewBtn.textContent = state.privacy ? "◧" : "◨";
    editBtn.textContent = "✎";
    panel.classList.toggle("jobfill-hidden", state.privacy);
    panel.classList.toggle("jobfill-minimized", state.minimized);
  }

  function renderEditor(query) {
    let count = 0;

    const tools = document.createElement("div");
    tools.className = "jobfill-editor-tools";

    const addGroupBtn = makeActionButton("新增分组");
    addGroupBtn.addEventListener("click", () => {
      resumeData.push({
        group: "新分组",
        items: [{ id: makeId(), group: "新分组", label: "新字段", value: "" }]
      });
      scheduleSave();
      renderItems();
    });

    const addItemBtn = makeActionButton("新增字段");
    addItemBtn.addEventListener("click", () => {
      const group = resumeData[0] || { group: "基本信息", items: [] };
      if (!resumeData.length) resumeData.push(group);
      group.items.push({ id: makeId(), group: group.group, label: "新字段", value: "" });
      scheduleSave();
      renderItems();
    });

    const saveBtn = makeActionButton("保存");
    saveBtn.addEventListener("click", () => saveData("已保存"));

    const exportBtn = makeActionButton("导出备份");
    exportBtn.addEventListener("click", exportData);

    const importBtn = makeActionButton("导入备份");
    importBtn.addEventListener("click", importData);

    tools.append(addGroupBtn, addItemBtn, saveBtn, exportBtn, importBtn);
    body.appendChild(tools);

    resumeData.forEach((group, groupIndex) => {
      const items = group.items.filter((item) => itemMatches(item, query));
      if (query && !items.length && !normalizeText(group.group).toLowerCase().includes(query)) {
        return;
      }
      count += items.length;

      const card = document.createElement("div");
      card.className = "jobfill-edit-group";

      const head = document.createElement("div");
      head.className = "jobfill-edit-group-head";

      const nameInput = document.createElement("input");
      nameInput.className = "jobfill-edit-title";
      nameInput.value = group.group;
      nameInput.addEventListener("input", () => {
        group.group = nameInput.value;
        group.items.forEach((item) => {
          item.group = group.group;
        });
        scheduleSave();
      });

      const addBtn = makeIconButton("+", "给这个分组新增字段");
      addBtn.addEventListener("click", () => {
        group.items.push({ id: makeId(), group: group.group, label: "新字段", value: "" });
        scheduleSave();
        renderItems();
      });

      const removeBtn = makeIconButton("×", "删除这个分组");
      removeBtn.addEventListener("click", () => {
        resumeData.splice(groupIndex, 1);
        scheduleSave();
        renderItems();
      });

      head.append(nameInput, addBtn, removeBtn);
      card.appendChild(head);

      const list = document.createElement("div");
      list.className = "jobfill-edit-list";

      items.forEach((item) => {
        const itemIndex = group.items.indexOf(item);
        const row = document.createElement("div");
        row.className = "jobfill-edit-item";

        const labelInput = document.createElement("input");
        labelInput.className = "jobfill-edit-label";
        labelInput.value = item.label;
        labelInput.placeholder = "字段名，比如 项目经历 1";
        labelInput.addEventListener("input", () => {
          item.label = labelInput.value;
          scheduleSave();
        });

        const valueInput = document.createElement("textarea");
        valueInput.className = "jobfill-edit-value";
        valueInput.value = Array.isArray(item.value) ? item.value.join("\n") : String(item.value ?? "");
        valueInput.placeholder = "内容可以写多段，换行会保留";
        valueInput.rows = Math.max(3, Math.min(8, valueInput.value.split("\n").length + 1));
        valueInput.addEventListener("input", () => {
          item.value = valueInput.value;
          valueInput.rows = Math.max(3, Math.min(8, valueInput.value.split("\n").length + 1));
          scheduleSave();
        });

        const fillBtn = makeActionButton("填入");
        fillBtn.addEventListener("click", () => {
          const target = getTargetElement();
          const filled = fillElement(target, item.value);
          statusEl.textContent = filled ? `已填入：${item.label}` : "先点一下页面上的输入框";
        });

        const copyBtn = makeActionButton("复制");
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(String(item.value ?? ""));
            statusEl.textContent = `已复制：${item.label}`;
          } catch {
            statusEl.textContent = "复制失败，可以直接选中文本";
          }
        });

        const insertUpBtn = makeActionButton("上插");
        insertUpBtn.title = "在上方插入一行";
        insertUpBtn.addEventListener("click", () => {
          group.items.splice(itemIndex, 0, {
            id: makeId(),
            group: group.group,
            label: "新字段",
            value: ""
          });
          scheduleSave();
          renderItems();
        });

        const insertDownBtn = makeActionButton("下插");
        insertDownBtn.title = "在下方插入一行";
        insertDownBtn.addEventListener("click", () => {
          group.items.splice(itemIndex + 1, 0, {
            id: makeId(),
            group: group.group,
            label: "新字段",
            value: ""
          });
          scheduleSave();
          renderItems();
        });

        const deleteBtn = makeIconButton("×", "删除字段");
        deleteBtn.addEventListener("click", () => {
          group.items.splice(itemIndex, 1);
          scheduleSave();
          renderItems();
        });

        const rowTools = document.createElement("div");
        rowTools.className = "jobfill-edit-item-tools";
        rowTools.append(fillBtn, insertUpBtn, insertDownBtn, copyBtn, deleteBtn);

        row.append(labelInput, valueInput, rowTools);
        list.appendChild(row);
      });

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "jobfill-empty";
        empty.textContent = "这个分组里没有匹配字段";
        list.appendChild(empty);
      }

      card.appendChild(list);
      body.appendChild(card);
    });

    if (!resumeData.length) {
      const empty = document.createElement("div");
      empty.className = "jobfill-empty";
      empty.textContent = "还没有字段，先新增一个分组";
      body.appendChild(empty);
    }

    statusEl.textContent = `编辑模式 · ${count} 个字段`;
    previewBtn.textContent = state.privacy ? "◧" : "◨";
    editBtn.textContent = "✓";
    panel.classList.toggle("jobfill-hidden", state.privacy);
    panel.classList.toggle("jobfill-minimized", state.minimized);
  }

  function makeActionButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jobfill-action-btn";
    button.textContent = text;
    return button;
  }

  function makeIconButton(text, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jobfill-icon-btn jobfill-small-btn";
    button.title = title;
    button.textContent = text;
    return button;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function previewValue(value) {
    const text = Array.isArray(value) ? value.join(" · ") : String(value ?? "");
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }

  function buildPanel() {
    if (document.getElementById(ROOT_ID)) return;

    root = document.createElement("div");
    root.id = ROOT_ID;

    panel = document.createElement("div");
    panel.className = "jobfill-panel";

    const header = document.createElement("div");
    header.className = "jobfill-header";

    const title = document.createElement("div");
    title.className = "jobfill-title";
    title.textContent = "JobFill";

    previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "jobfill-icon-btn";
    previewBtn.title = "切换隐私显示";
    previewBtn.textContent = "◨";
    previewBtn.addEventListener("click", () => {
      state.privacy = !state.privacy;
      renderItems();
    });

    editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "jobfill-icon-btn";
    editBtn.title = "编辑字段";
    editBtn.textContent = "✎";
    editBtn.addEventListener("click", () => {
      state.editMode = !state.editMode;
      state.privacy = false;
      renderItems();
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "jobfill-icon-btn";
    nextBtn.title = "跳到下一个输入框";
    nextBtn.textContent = "↦";
    nextBtn.addEventListener("click", () => {
      const fields = getFocusableElements();
      if (!fields.length) {
        statusEl.textContent = "没有找到可填写输入框";
        return;
      }
      const current = getTargetElement();
      const index = current ? fields.indexOf(current) : -1;
      const next = fields[(index + 1 + fields.length) % fields.length];
      next.focus();
      next.scrollIntoView({ block: "center", behavior: "smooth" });
      state.lastFocused = next;
      statusEl.textContent = "已跳转到下一个输入框";
      flash(next);
    });

    const minimizeBtn = document.createElement("button");
    minimizeBtn.type = "button";
    minimizeBtn.className = "jobfill-icon-btn";
    minimizeBtn.title = "收起面板";
    minimizeBtn.textContent = "–";
    minimizeBtn.addEventListener("click", () => {
      state.minimized = !state.minimized;
      renderItems();
    });

    header.append(title, previewBtn, editBtn, nextBtn, minimizeBtn);

    const searchWrap = document.createElement("div");
    searchWrap.className = "jobfill-search";

    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "搜索字段";
    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      renderItems();
    });
    searchWrap.appendChild(searchInput);

    statusEl = document.createElement("div");
    statusEl.className = "jobfill-status";
    statusEl.textContent = "0 个字段";

    body = document.createElement("div");
    body.className = "jobfill-body";

    panel.append(header, searchWrap, statusEl, body);
    root.appendChild(panel);
    document.documentElement.appendChild(root);
  }

  function enableDragging() {
    const header = panel.querySelector(".jobfill-header");
    let drag = null;

    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input")) return;
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: panel.offsetLeft,
        top: panel.offsetTop
      };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    window.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const nextLeft = Math.max(8, drag.left + (event.clientX - drag.startX));
      const nextTop = Math.max(8, drag.top + (event.clientY - drag.startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });

    window.addEventListener("pointerup", () => {
      drag = null;
    });
  }

  function attachListeners() {
    document.addEventListener("focusin", (event) => rememberFocus(event.target), true);
    document.addEventListener("pointerdown", (event) => rememberFocus(event.target), true);
    document.addEventListener("click", (event) => rememberFocus(event.target), true);
    window.addEventListener(DATA_EVENT, (event) => {
      resumeData = normalizeData(event.detail);
      if (body) {
        renderItems();
      }
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "JOBFILL_TOGGLE") {
        state.minimized = !state.minimized;
        renderItems();
      }
    });
  }

  function injectDataScript() {
    return new Promise((resolve) => {
      if (window.__JOBFILL_DATA__ || window.__TS_RESUME_DATA__) {
        resolve(normalizeData(window.__JOBFILL_DATA__ || window.__TS_RESUME_DATA__));
        return;
      }

      let settled = false;
      const settle = (payload) => {
        if (settled) return;
        settled = true;
        resolve(normalizeData(payload));
      };

      const onData = (event) => {
        settle(event.detail);
      };

      window.addEventListener(DATA_EVENT, onData, { once: true });

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("resume-data.js");
      script.onload = () => {
        setTimeout(() => {
          settle(window.__JOBFILL_DATA__ || window.__TS_RESUME_DATA__ || []);
          script.remove();
        }, 0);
      };
      script.onerror = () => {
        settle([
          {
            group: "基本信息",
            items: [{ label: "姓名", value: "你的姓名" }]
          }
        ]);
      };

      (document.documentElement || document.head).appendChild(script);
    });
  }

  async function init() {
    attachListeners();
    resumeData = await loadSavedData(await injectDataScript());
    buildPanel();
    enableDragging();
    renderItems();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
