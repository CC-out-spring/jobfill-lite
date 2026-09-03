(() => {
  const ROOT_ID = "jobfill-root";
  const DATA_EVENT = "jobfill:resume-data";
  const EDITABLE_SELECTOR =
    'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]), [contenteditable="true"]';

  const state = {
    search: "",
    privacy: false,
    editMode: false,
    minimized: true,
    position: null,
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
  let autoBtn;
  let minimizeBtn;
  let shell;
  let saveTimer = null;

  const FIELD_ALIAS_RULES = [
    ["姓名", "名字", "中文名", "name", "full name", "your name"],
    ["手机号", "手机", "电话", "mobile", "phone", "tel", "contact number"],
    ["邮箱", "电子邮箱", "email", "e-mail", "mail"],
    ["学校", "院校", "大学", "university", "college", "school"],
    ["院系", "学院", "系别", "department", "faculty"],
    ["专业", "major", "discipline", "subject"],
    ["学历", "最高学历", "education", "degree"],
    ["毕业时间", "毕业日期", "预计毕业时间", "graduation", "expected graduation"],
    ["出生日期", "生日", "date of birth", "dob", "birth date"],
    ["性别", "gender", "sex"],
    ["政治面貌", "political status"],
    ["实习公司", "实习单位", "company", "intern company", "employer"],
    ["实习岗位", "岗位", "职位", "position", "title", "intern role"],
    ["项目名称", "项目", "project name", "project"],
    ["项目描述", "项目简介", "description", "summary", "project summary"],
    ["证件号码", "身份证号", "id number", "identity number"],
    ["地址", "现居住地", "address", "location"],
    ["英语", "英文", "english", "cet", "toefl", "ielts"]
  ];

  const CONTEXT_ALIAS_RULES = [
    ["本科", "本科", "学士", "大学本科", "undergraduate", "bachelor"],
    ["硕士", "硕士", "研究生", "master", "graduate"],
    ["博士", "博士", "phd", "doctor"],
    ["高中", "高中", "high school"],
    ["第一", "第一", "第1", "1st", "first"],
    ["第二", "第二", "第2", "2nd", "second"],
    ["第三", "第三", "第3", "3rd", "third"]
  ];

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

  function getDataItems() {
    let order = 0;
    return resumeData.flatMap((group) =>
      group.items.map((item) => {
        const sourceText = `${group.group} ${item.label}`;
        return {
          ...item,
          group: group.group,
          key: canonicalFieldKey(item.label),
          contexts: contextKeys(sourceText),
          order: order++,
          text: normalizeSearchText(sourceText)
        };
      })
    );
  }

  function normalizeSearchText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[\s:：*＊_\\/\-—–|()[\]{}<>]+/g, "")
      .trim();
  }

  function getElementText(el) {
    const texts = [];
    const add = (value) => {
      const text = normalizeText(value);
      if (text) texts.push(text);
    };

    add(el.getAttribute("aria-label"));
    add(el.getAttribute("placeholder"));
    add(el.getAttribute("name"));
    add(el.getAttribute("id"));
    add(el.getAttribute("title"));

    const id = el.getAttribute("id");
    if (id) {
      document.querySelectorAll(`label[for="${CSS.escape(id)}"]`).forEach((label) => add(label.textContent));
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) add(wrappingLabel.textContent);

    let cursor = el.parentElement;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      [...cursor.children].forEach((child) => {
        if (child === el || child.contains(el) || inPanel(child)) return;
        const rect = child.getBoundingClientRect();
        if (rect.height > 80 || normalizeText(child.textContent).length > 80) return;
        add(child.textContent);
      });
      cursor = cursor.parentElement;
    }

    return [...new Set(texts)].join(" ");
  }

  function fieldAliases(label) {
    const base = normalizeSearchText(label);
    const aliases = new Set([base]);
    FIELD_ALIAS_RULES.forEach((rule) => {
      const normalized = rule.map(normalizeSearchText);
      if (normalized.some((alias) => base.includes(alias) || alias.includes(base))) {
        normalized.forEach((alias) => aliases.add(alias));
      }
    });
    return [...aliases].filter(Boolean);
  }

  function canonicalFieldKey(text) {
    const base = normalizeSearchText(text);
    const matched = FIELD_ALIAS_RULES.find((rule) =>
      rule.map(normalizeSearchText).some((alias) => alias && (base.includes(alias) || alias.includes(base)))
    );
    return matched ? normalizeSearchText(matched[0]) : base;
  }

  function contextKeys(text) {
    const base = normalizeSearchText(text);
    return CONTEXT_ALIAS_RULES.filter((rule) =>
      rule.map(normalizeSearchText).some((alias) => alias && base.includes(alias))
    ).map((rule) => normalizeSearchText(rule[0]));
  }

  function hasCommonValue(left, right) {
    return left.some((value) => right.includes(value));
  }

  function scoreMatch(el, item) {
    const rawFieldText = getElementText(el);
    const fieldText = normalizeSearchText(rawFieldText);
    const fieldContexts = contextKeys(rawFieldText);
    const aliases = fieldAliases(`${item.group} ${item.label}`);
    const labelAliases = fieldAliases(item.label);
    let score = 0;

    if (fieldText) {
      [...aliases, ...labelAliases].forEach((alias) => {
        if (!alias) return;
        if (fieldText === alias) score = Math.max(score, 100);
        else if (fieldText.includes(alias)) score = Math.max(score, alias.length >= 2 ? 88 : 0);
        else if (alias.includes(fieldText) && fieldText.length >= 2) score = Math.max(score, 78);
      });
    }

    if (el instanceof HTMLInputElement) {
      const type = el.type;
      if (type === "email" && labelAliases.some((alias) => ["邮箱", "email", "mail"].includes(alias))) score += 10;
      if (["tel", "number"].includes(type) && labelAliases.some((alias) => ["手机号", "手机", "电话", "phone", "mobile", "tel"].includes(alias))) score += 8;
    }

    if (score > 0 && fieldContexts.length && item.contexts.length) {
      score += hasCommonValue(fieldContexts, item.contexts) ? 14 : -12;
    }

    return Math.min(score, 100);
  }

  function findBestMatch(el, dataItems, usage) {
    const candidates = dataItems
      .filter((item) => String(item.value ?? "").trim())
      .map((item) => ({ item, score: scoreMatch(el, item) }))
      .sort((a, b) => b.score - a.score || a.item.order - b.item.order);

    const strongest = candidates[0];
    if (!strongest || strongest.score < 78) return strongest || null;

    const sameKeyCandidates = candidates.filter(
      (candidate) => candidate.item.key === strongest.item.key && candidate.score >= strongest.score - 18
    );
    const unusedCandidate = sameKeyCandidates.find((candidate) => !usage.usedIds.has(candidate.item.id));

    return unusedCandidate || strongest;
  }

  function autoFillPage() {
    const fields = getFocusableElements().filter((el) => {
      if (el instanceof HTMLInputElement && ["button", "submit", "reset", "file", "password"].includes(el.type)) {
        return false;
      }
      return true;
    });
    const dataItems = getDataItems();
    const usage = { usedIds: new Set() };
    const matched = [];
    const skipped = [];

    fields.forEach((field) => {
      const best = findBestMatch(field, dataItems, usage);
      if (!best || best.score < 78) {
        skipped.push(field);
        return;
      }

      const filled = fillElement(field, best.item.value);
      if (filled) {
        usage.usedIds.add(best.item.id);
        matched.push({ field, item: best.item, score: best.score });
      }
    });

    const message = matched.length
      ? `自动填了 ${matched.length} 项，${skipped.length} 项未匹配`
      : "没有找到高置信度匹配";
    statusEl.textContent = message;
    state.minimized = false;
    renderItems();
    statusEl.textContent = message;
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

  function savePosition(left, top) {
    chrome.storage.local.set({ jobfillPosition: { left, top } });
  }

  function saveUiState() {
    chrome.storage.local.set({
      jobfillUiState: {
        minimized: state.minimized,
        editMode: state.editMode,
        privacy: state.privacy
      }
    });
  }

  function loadUiState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["jobfillPosition", "jobfillUiState"], (result) => {
        const position = result?.jobfillPosition;
        if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
          state.position = position;
        }

        const uiState = result?.jobfillUiState || {};
        if (typeof uiState.minimized === "boolean") state.minimized = uiState.minimized;
        if (typeof uiState.editMode === "boolean") state.editMode = uiState.editMode;
        if (typeof uiState.privacy === "boolean") state.privacy = uiState.privacy;

        resolve();
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
    autoBtn.textContent = "A";
    minimizeBtn.textContent = state.minimized ? "+" : "–";
    minimizeBtn.title = state.minimized ? "展开面板" : "收起面板";
    root.classList.toggle("jobfill-hidden", state.privacy);
    root.classList.toggle("jobfill-minimized", state.minimized);
    saveUiState();
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
    autoBtn.textContent = "A";
    minimizeBtn.textContent = state.minimized ? "+" : "–";
    minimizeBtn.title = state.minimized ? "展开面板" : "收起面板";
    root.classList.toggle("jobfill-hidden", state.privacy);
    root.classList.toggle("jobfill-minimized", state.minimized);
    saveUiState();
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

    shell = document.createElement("div");
    shell.className = "jobfill-shell";

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

    autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "jobfill-icon-btn";
    autoBtn.title = "自动识别本页并填充";
    autoBtn.textContent = "A";
    autoBtn.addEventListener("click", () => {
      state.minimized = false;
      autoFillPage();
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

    minimizeBtn = document.createElement("button");
    minimizeBtn.type = "button";
    minimizeBtn.className = "jobfill-icon-btn";
    minimizeBtn.title = "收起面板";
    minimizeBtn.textContent = "–";
    minimizeBtn.addEventListener("click", () => {
      state.minimized = !state.minimized;
      renderItems();
    });

    header.append(title, previewBtn, editBtn, autoBtn, nextBtn, minimizeBtn);

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
    shell.appendChild(panel);
    root.appendChild(shell);
    document.documentElement.appendChild(root);

    if (state.position) {
      root.style.left = `${state.position.left}px`;
      root.style.top = `${state.position.top}px`;
      root.style.right = "auto";
    }
  }

  function enableDragging() {
    const dragHandle = shell;
    let drag = null;

    dragHandle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, textarea, select")) return;
      const rect = root.getBoundingClientRect();
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false
      };
      dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    window.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        drag.moved = true;
      }
      const maxLeft = Math.max(8, window.innerWidth - drag.width - 8);
      const maxTop = Math.max(8, window.innerHeight - 48);
      const nextLeft = Math.min(maxLeft, Math.max(8, drag.left + deltaX));
      const nextTop = Math.min(maxTop, Math.max(8, drag.top + deltaY));
      root.style.left = `${nextLeft}px`;
      root.style.top = `${nextTop}px`;
      root.style.right = "auto";
    });

    window.addEventListener("pointerup", () => {
      if (drag) {
        if (state.minimized && !drag.moved) {
          state.minimized = false;
          renderItems();
          drag = null;
          return;
        }

        const rect = root.getBoundingClientRect();
        const isNearLeft = rect.left < 100;
        const isNearRight = window.innerWidth - rect.right < 100;
        const isNearTop = rect.top < 100;
        const isNearBottom = window.innerHeight - rect.bottom < 100;
        let nextLeft = rect.left;
        let nextTop = rect.top;

        if (isNearLeft) nextLeft = 8;
        else if (isNearRight) nextLeft = Math.max(8, window.innerWidth - rect.width - 8);

        if (isNearTop) nextTop = 8;
        else if (isNearBottom) nextTop = Math.max(8, window.innerHeight - rect.height - 8);

        root.style.left = `${Math.round(nextLeft)}px`;
        root.style.top = `${Math.round(nextTop)}px`;
        savePosition(Math.round(nextLeft), Math.round(nextTop));
      }
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
    await loadUiState();
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
