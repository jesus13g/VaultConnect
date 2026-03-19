const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} = require("obsidian");

const SIDEBAR_VIEW_TYPE = "obsidian-connect-sidebar";

const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:8000",
  email: "",
  password: "",
  accessToken: "",
  selectedVaultId: "",
  selectedVaultName: "",
  deviceName: "obsidian-desktop",
  excludedPrefixes: [".obsidian/", ".trash/", ".git/"],
  batchSize: 50,
  oauthPollSeconds: 120,
  localSnapshot: {},
  remoteSnapshot: {},
  lastPushAt: "",
  lastPullAt: "",
};

module.exports = class ObsidianConnectPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new ObsidianConnectSidebarView(leaf, this));

    this.addSettingTab(new ObsidianConnectSettingTab(this.app, this));

    this.addCommand({
      id: "obsidian-connect-login",
      name: "obsidianConnect: iniciar sesion en backend",
      callback: async () => {
        await this.login();
      },
    });

    this.addCommand({
      id: "obsidian-connect-select-vault",
      name: "obsidianConnect: selector visual de vaults",
      callback: async () => {
        await this.selectVault();
      },
    });

    this.addCommand({
      id: "obsidian-connect-create-vault",
      name: "obsidianConnect: crear vault en backend desde la boveda actual",
      callback: async () => {
        await this.createBackendVaultFromCurrentVault();
      },
    });

    this.addCommand({
      id: "obsidian-connect-google-login",
      name: "obsidianConnect: iniciar sesion con Google",
      callback: async () => {
        await this.loginWithGoogle();
      },
    });

    this.addCommand({
      id: "obsidian-connect-google-drive",
      name: "obsidianConnect: conectar Google Drive para tu cuenta",
      callback: async () => {
        await this.connectGoogleDrive();
      },
    });

    this.addCommand({
      id: "obsidian-connect-open-web",
      name: "obsidianConnect: abrir panel web del backend",
      callback: async () => {
        this.openBackendWeb();
      },
    });

    this.addCommand({
      id: "obsidian-connect-push-vault",
      name: "obsidianConnect: sincronizacion incremental hacia el backend",
      callback: async () => {
        await this.pushVault();
      },
    });

    this.addCommand({
      id: "obsidian-connect-pull-vault",
      name: "obsidianConnect: descargar solo cambios remotos",
      callback: async () => {
        await this.pullVault();
      },
    });

    this.addRibbonIcon("cloud", "obsidianConnect: subir cambios", async () => {
      await this.pushVault();
    });

    this.addRibbonIcon("folder-open", "obsidianConnect: selector visual de vaults", async () => {
      await this.selectVault();
    });

    this.addRibbonIcon("refresh-cw", "obsidianConnect: panel lateral", async () => {
      await this.activateSidebarView();
    });

    this.addCommand({
      id: "obsidian-connect-open-sidebar",
      name: "obsidianConnect: abrir panel lateral",
      callback: async () => {
        await this.activateSidebarView();
      },
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.activateSidebarView();
    });
  }

  async activateSidebarView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshSidebarView() {
    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof ObsidianConnectSidebarView) {
        leaf.view.loadAndRender();
      }
    }
  }

  async fetchDriveVaults() {
    try {
      return await this.request("/api/v1/drive/vaults");
    } catch (error) {
      if (/not connected|not found/i.test(String(error.message || ""))) {
        return null;
      }
      throw error;
    }
  }

  async fetchBackendVaults() {
    return await this.request("/api/v1/vaults");
  }

  async syncDriveVaults() {
    return await this.request("/api/v1/drive/vaults/sync", { method: "POST" });
  }

  async importFromDrive(folder) {
    const vault = await this.request("/api/v1/vaults", {
      method: "POST",
      body: {
        name: folder.name,
        slug: slugify(folder.name),
        description: "Importada desde Google Drive",
        drive_folder_id: folder.drive_folder_id,
      },
    });
    new Notice("Boveda creada en backend: " + vault.name + ". Descargando archivos...");
    await this.pullVault(vault.id);
    return vault;
  }

  async pushVaultToDrive(vault) {
    await this.pushVault(vault.id);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.excludedPrefixes = normalizeExcludedPrefixes(this.settings.excludedPrefixes);
    this.settings.localSnapshot = ensureObject(this.settings.localSnapshot);
    this.settings.remoteSnapshot = ensureObject(this.settings.remoteSnapshot);
    this.settings.batchSize = getBatchSize(this.settings.batchSize);
    this.settings.oauthPollSeconds = getOauthPollSeconds(this.settings.oauthPollSeconds);
  }

  async saveSettings() {
    this.settings.excludedPrefixes = normalizeExcludedPrefixes(this.settings.excludedPrefixes);
    this.settings.localSnapshot = ensureObject(this.settings.localSnapshot);
    this.settings.remoteSnapshot = ensureObject(this.settings.remoteSnapshot);
    this.settings.batchSize = getBatchSize(this.settings.batchSize);
    this.settings.oauthPollSeconds = getOauthPollSeconds(this.settings.oauthPollSeconds);
    await this.saveData(this.settings);
  }

  async login() {
    if (!this.settings.email || !this.settings.password) {
      new Notice("Configura email y contrasena del backend en los ajustes del plugin.");
      return null;
    }

    const response = await this.request("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: this.settings.email,
        password: this.settings.password,
      },
      skipAuth: true,
    });

    this.settings.accessToken = response.access_token;
    await this.saveSettings();
    new Notice("Sesion de obsidianConnect iniciada.");
    this.refreshSidebarView();
    return response;
  }

  async ensureToken() {
    if (this.settings.accessToken) {
      return this.settings.accessToken;
    }

    const response = await this.login();
    return response ? response.access_token : null;
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    const skipAuth = Boolean(options.skipAuth);
    const retried = Boolean(options.retried);
    const token = skipAuth ? "" : await this.ensureToken();
    const url = buildUrl(this.settings.backendUrl, path, options.query);

    const headers = Object.assign(
      {
        Accept: "application/json",
      },
      options.headers || {}
    );

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    const response = await requestUrl({
      url,
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      throw: false,
    });

    if (response.status === 401 && !skipAuth && !retried) {
      this.settings.accessToken = "";
      await this.saveSettings();
      await this.login();
      return this.request(path, Object.assign({}, options, { retried: true }));
    }

    const payload = parseJsonResponse(response.text);
    if (response.status >= 400) {
      const message =
        (payload && (payload.detail || payload.message)) ||
        "Error HTTP " + String(response.status);
      throw new Error(message);
    }

    return payload;
  }

  async fetchVaults(showNotice) {
    const vaults = await this.request("/api/v1/vaults");
    if (showNotice) {
      new Notice("Vaults cargados: " + String(vaults.length));
    }
    return vaults;
  }

  async selectVault() {
    const vaults = await this.fetchVaults(false);
    if (!vaults.length) {
      new Notice("No hay bovedas en el backend todavia.");
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const modal = new VaultBrowserModal(this.app, this, vaults, async (vault) => {
        this.settings.selectedVaultId = vault.id;
        this.settings.selectedVaultName = vault.name;
        await this.saveSettings();
        new Notice("Vault vinculado: " + vault.name);
        settle(vault);
      }, () => {
        settle(null);
      });
      modal.open();
    });
  }

  async createBackendVaultFromCurrentVault() {
    const name = this.app.vault.getName();
    const payload = {
      name,
      slug: slugify(name),
      description: "Vault creado desde el plugin de Obsidian",
      local_path: getVaultBasePath(this.app),
    };

    const vault = await this.request("/api/v1/vaults", {
      method: "POST",
      body: payload,
    });

    this.settings.selectedVaultId = vault.id;
    this.settings.selectedVaultName = vault.name;
    await this.saveSettings();
    new Notice("Vault creado y vinculado: " + vault.name);
    return vault;
  }

  async loginWithGoogle() {
    const nonce = generateNonce();
    const response = await this.request("/api/v1/auth/google/login-url", {
      query: { nonce },
      skipAuth: true,
    });

    openExternalUrl(response.authorization_url);
    new Notice("Completa el inicio de sesion con Google en el navegador.");

    const tokenData = await this.pollGoogleLoginToken(nonce);
    if (!tokenData) {
      new Notice("No se confirmo el inicio de sesion en el tiempo esperado.");
      return;
    }

    this.settings.accessToken = tokenData.access_token;
    await this.saveSettings();
    new Notice("Sesion iniciada con Google: " + (tokenData.user?.email || ""));
    this.refreshSidebarView();
  }

  async pollGoogleLoginToken(nonce) {
    const maxSeconds = this.settings.oauthPollSeconds;
    const stepMs = 3000;
    const tries = Math.ceil((maxSeconds * 1000) / stepMs);

    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        const result = await this.request("/api/v1/auth/google/login-token", {
          query: { nonce },
          skipAuth: true,
        });
        if (result && result.access_token) {
          return result;
        }
      } catch (_err) {
        // Aún no está listo, seguir intentando
      }
      await sleep(stepMs);
    }
    return null;
  }

  async connectGoogleDrive() {
    const response = await this.request("/api/v1/auth/google/url");

    openExternalUrl(response.authorization_url);
    new Notice("Completa la autorizacion de Google Drive en el navegador.");

    const connection = await this.pollGoogleConnection();
    if (!connection) {
      new Notice("No se confirmo la conexion en el tiempo esperado. Puedes reintentar.");
      return;
    }

    const account = connection.external_account_email || "cuenta conectada";
    new Notice("Google Drive conectado: " + account);
    this.refreshSidebarView();
  }

  async pollGoogleConnection() {
    const maxSeconds = this.settings.oauthPollSeconds;
    const stepMs = 3000;
    const tries = Math.ceil((maxSeconds * 1000) / stepMs);

    for (let attempt = 0; attempt < tries; attempt += 1) {
      const connection = await this.fetchUserConnectionStatus(true);
      if (connection && connection.status === "connected") {
        return connection;
      }
      await sleep(stepMs);
    }

    return null;
  }

  async fetchUserConnectionStatus(allowMissing) {
    try {
      return await this.request("/api/v1/auth/google/status");
    } catch (error) {
      if (allowMissing && /not found/i.test(String(error.message || ""))) {
        return null;
      }
      throw error;
    }
  }

  async fetchConnectionStatus(vaultId, allowMissing) {
    try {
      return await this.request(
        "/api/v1/vaults/" + encodeURIComponent(vaultId) + "/connection"
      );
    } catch (error) {
      if (allowMissing && /not found/i.test(String(error.message || ""))) {
        return null;
      }
      throw error;
    }
  }

  openBackendWeb() {
    const url = buildUrl(this.settings.backendUrl, "/", null);
    openExternalUrl(url);
    new Notice("Panel web abierto.");
  }

  async pushVault(overrideVaultId) {
    const vaultId = overrideVaultId || await this.ensureSelectedVault();
    if (!vaultId) {
      return;
    }

    const files = this.getSyncableFiles();
    if (!files.length) {
      new Notice("No hay archivos sincronizables en la boveda actual.");
      return;
    }

    const changedFiles = this.getChangedLocalFiles(files);
    if (!changedFiles.length) {
      new Notice("No hay cambios locales pendientes para subir.");
      return;
    }

    new Notice("Preparando " + String(changedFiles.length) + " archivos modificados...");
    const items = [];
    for (const file of changedFiles) {
      items.push(await this.buildSyncItem(file));
    }

    const batches = chunk(items, this.settings.batchSize);
    for (let index = 0; index < batches.length; index += 1) {
      await this.request("/api/v1/vaults/" + encodeURIComponent(vaultId) + "/sync/manual", {
        method: "POST",
        body: {
          device_name: this.settings.deviceName || "obsidian-desktop",
          items: batches[index],
        },
      });
      new Notice(
        "obsidianConnect: lote " +
          String(index + 1) +
          " de " +
          String(batches.length) +
          " enviado."
      );
    }

    await this.refreshLocalSnapshot();
    this.settings.lastPushAt = new Date().toISOString();
    await this.saveSettings();
    this.refreshSidebarView();
    new Notice("Sincronizacion incremental completada.");
  }

  async pullVault(overrideVaultId) {
    const vaultId = overrideVaultId || await this.ensureSelectedVault();
    if (!vaultId) {
      return;
    }

    new Notice("Solicitando cambios remotos...");
    await this.request("/api/v1/vaults/" + encodeURIComponent(vaultId) + "/sync/pull", {
      method: "POST",
    });

    const files = await this.request("/api/v1/vaults/" + encodeURIComponent(vaultId) + "/files");
    const changedFiles = await this.getChangedRemoteFiles(files);

    if (!changedFiles.length) {
      await this.refreshRemoteSnapshot(files);
      this.settings.lastPullAt = new Date().toISOString();
      await this.saveSettings();
      new Notice("No hay cambios remotos nuevos para descargar.");
      return;
    }

    let downloaded = 0;
    for (const file of changedFiles) {
      const path = normalizePath(file.path);
      const payload = await this.request(
        "/api/v1/vaults/" + encodeURIComponent(vaultId) + "/files/content",
        {
          query: { path },
        }
      );

      await ensureParentFolder(this.app, path);
      await this.writeRemoteFile(path, payload);
      downloaded += 1;
    }

    await this.refreshRemoteSnapshot(files);
    await this.refreshLocalSnapshot();
    this.settings.lastPullAt = new Date().toISOString();
    await this.saveSettings();
    this.refreshSidebarView();
    new Notice("Cambios remotos aplicados en local: " + String(downloaded) + " archivos.");
  }

  getSyncableFiles() {
    return this.app.vault.getFiles().filter((file) => !this.isExcluded(file.path));
  }

  getChangedLocalFiles(files) {
    return files.filter((file) => {
      const path = normalizePath(file.path);
      const snapshot = this.settings.localSnapshot[path];
      const current = getLocalSignature(file);
      return !snapshot || snapshot.mtime !== current.mtime || snapshot.size !== current.size;
    });
  }

  async getChangedRemoteFiles(files) {
    const changed = [];

    for (const file of files) {
      const path = normalizePath(file.path);
      if (this.isExcluded(path)) {
        continue;
      }

      const remoteSignature = getRemoteSignature(file);
      const snapshot = this.settings.remoteSnapshot[path];
      const localExists = await this.app.vault.adapter.exists(path);
      const remoteChanged =
        !snapshot ||
        snapshot.remote_version !== remoteSignature.remote_version ||
        snapshot.modified_at !== remoteSignature.modified_at ||
        snapshot.size_bytes !== remoteSignature.size_bytes ||
        snapshot.content_hash !== remoteSignature.content_hash;

      if (remoteChanged || !localExists) {
        changed.push(file);
      }
    }

    return changed;
  }

  isExcluded(path) {
    const normalized = normalizePath(path);
    return this.settings.excludedPrefixes.some((prefix) => {
      return normalized === trimTrailingSlash(prefix) || normalized.startsWith(prefix);
    });
  }

  async buildSyncItem(file) {
    const mimeType = getMimeType(file.extension);
    const item = {
      path: normalizePath(file.path),
      mime_type: mimeType,
      modified_at: new Date(file.stat.mtime).toISOString(),
      size_bytes: file.stat.size,
    };

    if (isTextFile(file.extension, mimeType)) {
      item.content = await this.app.vault.cachedRead(file);
      return item;
    }

    const binary = await this.app.vault.adapter.readBinary(normalizePath(file.path));
    item.base64_content = arrayBufferToBase64(binary);
    return item;
  }

  async writeRemoteFile(path, payload) {
    if (typeof payload.content === "string") {
      await this.app.vault.adapter.write(path, payload.content);
      return;
    }

    const binary = base64ToArrayBuffer(payload.base64_content || "");
    await this.app.vault.adapter.writeBinary(path, binary);
  }

  async refreshLocalSnapshot() {
    const next = {};
    const files = this.getSyncableFiles();
    for (const file of files) {
      next[normalizePath(file.path)] = getLocalSignature(file);
    }
    this.settings.localSnapshot = next;
  }

  async refreshRemoteSnapshot(files) {
    const next = {};
    for (const file of files) {
      const path = normalizePath(file.path);
      if (!this.isExcluded(path)) {
        next[path] = getRemoteSignature(file);
      }
    }
    this.settings.remoteSnapshot = next;
  }

  async ensureSelectedVault() {
    if (this.settings.selectedVaultId) {
      return this.settings.selectedVaultId;
    }

    const vaults = await this.fetchVaults(false);
    if (!vaults.length) {
      new Notice("No hay bovedas en el backend. Creando una desde la boveda actual...");
      const vault = await this.createBackendVaultFromCurrentVault();
      return vault ? vault.id : "";
    }

    const selected = await this.selectVault();
    return selected ? selected.id : "";
  }
};

class ObsidianConnectSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.driveVaults = null;
    this.localVaults = null;
    this.driveError = null;
    this.fetching = false;
    this.connectionStatus = null;
  }

  getViewType() { return SIDEBAR_VIEW_TYPE; }
  getDisplayText() { return "obsidianConnect"; }
  getIcon() { return "refresh-cw"; }
  async onOpen() { await this.loadAndRender(); }
  onClose() { this.containerEl.empty(); }

  async loadAndRender() {
    if (this.fetching) return;
    this.fetching = true;
    this.render();
    try {
      const hasToken = !!this.plugin.settings.accessToken;
      if (hasToken) {
        const [driveResult, connResult] = await Promise.allSettled([
          this.plugin.fetchDriveVaults(),
          this.plugin.fetchUserConnectionStatus(true),
        ]);
        this.connectionStatus = connResult.status === "fulfilled" ? connResult.value : null;
        const driveVaults = driveResult.status === "fulfilled" ? driveResult.value : null;
        this.localVaults = driveVaults !== null
          ? await this.plugin.syncDriveVaults()
          : await this.plugin.fetchBackendVaults();
        this.driveVaults = driveVaults;
        this.driveError = null;
      } else {
        this.driveVaults = null;
        this.localVaults = [];
        this.connectionStatus = null;
      }
    } catch (err) {
      this.driveError = err.message || String(err);
    }
    this.fetching = false;
    this.render();
  }

  _buildMergedList() {
    const drive = this.driveVaults || [];
    const local = this.localVaults || [];
    const rows = [];
    const usedLocalIds = new Set();
    for (const folder of drive) {
      const linked = local.find((v) => v.root_folder_id === folder.drive_folder_id);
      if (linked) usedLocalIds.add(linked.id);
      rows.push({ drive: folder, local: linked || null });
    }
    for (const vault of local) {
      if (!usedLocalIds.has(vault.id)) rows.push({ drive: null, local: vault });
    }
    return rows;
  }

  render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.className = "obsidian-connect-sidebar";

    const style = containerEl.createEl("style");
    style.textContent = `
      .obsidian-connect-sidebar { overflow-y:auto; }
      @keyframes oc-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      .oc-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:13px 14px 10px; border-bottom:1px solid var(--background-modifier-border);
        position:sticky; top:0; background:var(--background-primary); z-index:1;
      }
      .oc-brand { display:flex; align-items:center; gap:7px; }
      .oc-brand-icon { color:var(--interactive-accent); flex-shrink:0; }
      .oc-brand-title { font-size:13px; font-weight:700; letter-spacing:-.01em; margin:0; }
      .oc-header-actions { display:flex; gap:2px; }
      .oc-icon-btn {
        background:none; border:none; cursor:pointer; padding:5px; border-radius:6px;
        color:var(--text-muted); display:flex; align-items:center; justify-content:center;
        transition:background .15s,color .15s;
      }
      .oc-icon-btn:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
      .oc-icon-btn:disabled { opacity:.4; cursor:default; }
      .oc-spin { animation:oc-spin .9s linear infinite; }
      .oc-connection {
        display:flex; align-items:center; gap:6px; flex-wrap:wrap;
        padding:6px 14px; font-size:11px; color:var(--text-muted);
        background:var(--background-secondary);
        border-bottom:1px solid var(--background-modifier-border);
      }
      .oc-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
      .oc-dot-green { background:#4caf50; box-shadow:0 0 5px rgba(76,175,80,.5); }
      .oc-dot-gray { background:var(--text-faint); }
      .oc-conn-email { font-weight:600; color:var(--text-normal); }
      .oc-connect-btn {
        margin-left:auto; font-size:10px; padding:2px 9px; border-radius:4px;
        cursor:pointer; background:var(--interactive-accent);
        color:var(--text-on-accent); border:none; font-weight:600;
      }
      .oc-toolbar {
        display:grid; grid-template-columns:repeat(4,1fr); gap:5px;
        padding:10px 14px; border-bottom:1px solid var(--background-modifier-border);
      }
      .oc-action-btn {
        display:flex; flex-direction:column; align-items:center; gap:3px;
        padding:8px 4px; border-radius:8px; cursor:pointer; border:none;
        background:var(--background-secondary); color:var(--text-muted);
        font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
        transition:background .15s,color .15s,transform .1s;
      }
      .oc-action-btn:hover:not(:disabled) { background:var(--background-modifier-hover); color:var(--text-normal); }
      .oc-action-btn:active:not(:disabled) { transform:scale(.94); }
      .oc-action-btn:disabled { opacity:.32; cursor:default; }
      .oc-act-primary {
        background:var(--interactive-accent); color:var(--text-on-accent);
      }
      .oc-act-primary:hover:not(:disabled) { filter:brightness(1.1); background:var(--interactive-accent); }
      .oc-error {
        margin:8px 14px; padding:8px 12px; border-radius:8px;
        background:rgba(255,80,80,.08); color:var(--text-error); font-size:11px;
        border:1px solid rgba(255,80,80,.2);
      }
      .oc-section { padding:0 14px 8px; }
      .oc-section-label {
        font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
        color:var(--text-faint); padding:12px 0 7px; display:flex; align-items:center; gap:8px;
      }
      .oc-section-label::after { content:''; flex:1; height:1px; background:var(--background-modifier-border); }
      .oc-vault-card {
        border:1px solid var(--background-modifier-border); border-radius:10px;
        padding:10px 12px; margin-bottom:8px; background:var(--background-primary-alt);
        transition:border-color .15s;
      }
      .oc-vault-card:hover { border-color:var(--background-modifier-border-hover,var(--background-modifier-border)); }
      .oc-vault-card.oc-active {
        border-color:var(--interactive-accent);
        box-shadow:inset 3px 0 0 var(--interactive-accent);
      }
      .oc-vault-top { display:flex; align-items:flex-start; gap:8px; margin-bottom:7px; }
      .oc-vault-icon { color:var(--interactive-accent); flex-shrink:0; margin-top:1px; }
      .oc-vault-meta { flex:1; min-width:0; }
      .oc-vault-name {
        font-size:13px; font-weight:600; color:var(--text-normal);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .oc-vault-slug {
        font-size:11px; color:var(--text-muted); overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; margin-top:1px;
      }
      .oc-badges { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
      .oc-badge {
        display:inline-flex; align-items:center; gap:3px; font-size:10px;
        font-weight:600; padding:2px 7px; border-radius:20px; letter-spacing:.02em;
      }
      .oc-badge-active { background:rgba(var(--accent-h,255),100%,60%,.15); color:var(--interactive-accent); }
      .oc-badge-drive { background:rgba(66,133,244,.15); color:#4285f4; }
      .oc-badge-synced { background:rgba(76,175,80,.15); color:#4caf50; }
      .oc-badge-pending { background:rgba(255,152,0,.15); color:#ff9800; }
      .oc-badge-idle { background:var(--background-modifier-border); color:var(--text-muted); }
      .oc-vault-actions { display:flex; gap:5px; flex-wrap:wrap; }
      .oc-card-btn {
        flex:1; min-width:48px; padding:5px 8px; border-radius:6px; cursor:pointer;
        font-size:11px; font-weight:600; border:1px solid var(--background-modifier-border);
        background:var(--background-secondary); color:var(--text-normal);
        transition:background .15s; display:flex; align-items:center;
        justify-content:center; gap:4px; white-space:nowrap;
      }
      .oc-card-btn:hover:not(:disabled) { background:var(--background-modifier-hover); }
      .oc-card-btn:disabled { opacity:.4; cursor:default; }
      .oc-card-btn-accent {
        background:var(--interactive-accent); color:var(--text-on-accent); border-color:transparent;
      }
      .oc-card-btn-accent:hover:not(:disabled) { filter:brightness(1.1); background:var(--interactive-accent); }
      .oc-empty {
        padding:22px 0; text-align:center; color:var(--text-muted); font-size:12px;
        display:flex; flex-direction:column; align-items:center; gap:8px;
      }
      .oc-empty-icon { opacity:.22; }
      .oc-empty-create {
        width:100%; margin-top:4px; padding:8px 12px; border-radius:8px;
        cursor:pointer; font-size:12px; font-weight:600; border:none;
        background:var(--interactive-accent); color:var(--text-on-accent);
      }
      .oc-login { padding:22px 14px; display:flex; flex-direction:column; gap:10px; }
      .oc-login-title { font-size:15px; font-weight:700; text-align:center; margin:0 0 2px; }
      .oc-login-desc { font-size:12px; color:var(--text-muted); text-align:center; margin:0; line-height:1.5; }
      .oc-login-btn {
        width:100%; padding:10px 14px; border-radius:8px; cursor:pointer;
        font-weight:600; font-size:13px; border:none;
        transition:filter .15s,transform .1s;
        display:flex; align-items:center; justify-content:center; gap:8px;
      }
      .oc-login-btn:active { transform:scale(.98); }
      .oc-login-btn:disabled { opacity:.5; cursor:default; transform:none; }
      .oc-login-primary { background:var(--interactive-accent); color:var(--text-on-accent); }
      .oc-login-primary:hover:not(:disabled) { filter:brightness(1.08); }
      .oc-login-secondary {
        background:var(--background-secondary); color:var(--text-normal);
        border:1px solid var(--background-modifier-border) !important;
      }
      .oc-login-secondary:hover:not(:disabled) { background:var(--background-modifier-hover); }
      .oc-footer {
        padding:8px 14px 14px; display:flex; gap:14px; flex-wrap:wrap;
        border-top:1px solid var(--background-modifier-border); margin-top:4px;
      }
      .oc-ts { font-size:10px; color:var(--text-faint); display:flex; gap:4px; align-items:center; }
      .oc-ts-lbl { font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
    `;

    // ── Header ─────────────────────────────────────────────────────
    const header = containerEl.createDiv({ cls: "oc-header" });
    const brand = header.createDiv({ cls: "oc-brand" });
    brand.innerHTML = `<svg class="oc-brand-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
    brand.createEl("h4", { cls: "oc-brand-title", text: "obsidianConnect" });

    const headerActions = header.createDiv({ cls: "oc-header-actions" });
    const reloadBtn = headerActions.createEl("button", { cls: "oc-icon-btn" });
    reloadBtn.title = "Actualizar";
    reloadBtn.innerHTML = this.fetching
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="oc-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
    reloadBtn.addEventListener("click", () => this.loadAndRender());

    // ── Sin sesión ──────────────────────────────────────────────────
    if (!this.plugin.settings.accessToken) {
      const loginSection = containerEl.createDiv({ cls: "oc-login" });
      loginSection.createEl("h3", { cls: "oc-login-title", text: "Conectar cuenta" });
      loginSection.createEl("p", { cls: "oc-login-desc", text: "Inicia sesión para sincronizar tu bóveda con Google Drive." });

      const googleBtn = loginSection.createEl("button", { cls: "oc-login-btn oc-login-primary" });
      googleBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8m-4-4h8"/></svg> Iniciar sesión con Google`;
      googleBtn.addEventListener("click", async () => {
        googleBtn.disabled = true;
        googleBtn.textContent = "Abriendo navegador...";
        await this.plugin.loginWithGoogle();
        googleBtn.disabled = false;
        googleBtn.textContent = "Iniciar sesión con Google";
      });

      const emailBtn = loginSection.createEl("button", { cls: "oc-login-btn oc-login-secondary" });
      emailBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> Login con email`;
      emailBtn.addEventListener("click", async () => {
        emailBtn.disabled = true;
        await this.plugin.login();
        emailBtn.disabled = false;
      });
      return;
    }

    // ── Drive connection badge ──────────────────────────────────────
    const connEl = containerEl.createDiv({ cls: "oc-connection" });
    const isConnected = this.connectionStatus && this.connectionStatus.status === "connected";
    if (isConnected) {
      connEl.innerHTML = `<div class="oc-dot oc-dot-green"></div>`;
      connEl.createEl("span", { text: "Drive: " });
      connEl.createEl("span", { cls: "oc-conn-email", text: this.connectionStatus.external_account_email || "conectado" });
    } else {
      connEl.innerHTML = `<div class="oc-dot oc-dot-gray"></div>`;
      connEl.createEl("span", { text: "Google Drive no conectado" });
      const cBtn = connEl.createEl("button", { cls: "oc-connect-btn", text: "Conectar" });
      cBtn.addEventListener("click", async () => {
        cBtn.disabled = true;
        cBtn.textContent = "...";
        await this.plugin.connectGoogleDrive();
        await this.loadAndRender();
      });
    }

    // ── Error ──────────────────────────────────────────────────────
    if (this.driveError) {
      containerEl.createDiv({ cls: "oc-error", text: this.driveError });
    }

    // ── Quick Actions Toolbar ──────────────────────────────────────
    const hasVault = !!this.plugin.settings.selectedVaultId;
    const toolbar = containerEl.createDiv({ cls: "oc-toolbar" });

    const pushBtn = toolbar.createEl("button", { cls: "oc-action-btn" + (hasVault ? " oc-act-primary" : "") });
    pushBtn.disabled = !hasVault;
    pushBtn.title = hasVault ? "Subir cambios locales a Drive" : "Selecciona una bóveda primero";
    pushBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Push</span>`;
    pushBtn.addEventListener("click", async () => {
      pushBtn.disabled = true;
      try { await this.plugin.pushVault(); } catch (e) { new Notice("Error: " + e.message); }
      pushBtn.disabled = !hasVault;
    });

    const pullBtn = toolbar.createEl("button", { cls: "oc-action-btn" + (hasVault ? " oc-act-primary" : "") });
    pullBtn.disabled = !hasVault;
    pullBtn.title = hasVault ? "Descargar cambios remotos" : "Selecciona una bóveda primero";
    pullBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Pull</span>`;
    pullBtn.addEventListener("click", async () => {
      pullBtn.disabled = true;
      try { await this.plugin.pullVault(); } catch (e) { new Notice("Error: " + e.message); }
      pullBtn.disabled = !hasVault;
    });

    const newBtn = toolbar.createEl("button", { cls: "oc-action-btn" });
    newBtn.title = "Crear bóveda en backend desde la vault actual";
    newBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg><span>Nueva</span>`;
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      try { await this.plugin.createBackendVaultFromCurrentVault(); await this.loadAndRender(); }
      catch (e) { new Notice("Error: " + e.message); }
      newBtn.disabled = false;
    });

    const webBtn = toolbar.createEl("button", { cls: "oc-action-btn" });
    webBtn.title = "Abrir panel web del backend";
    webBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>Web</span>`;
    webBtn.addEventListener("click", () => this.plugin.openBackendWeb());

    // ── Loading ────────────────────────────────────────────────────
    if (this.fetching) {
      const ldEl = containerEl.createDiv({ cls: "oc-empty" });
      ldEl.innerHTML = `<svg class="oc-empty-icon oc-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>Cargando bóvedas...</span>`;
      return;
    }

    // ── Vault list ─────────────────────────────────────────────────
    const rows = this._buildMergedList();
    const section = containerEl.createDiv({ cls: "oc-section" });
    section.createDiv({ cls: "oc-section-label", text: "Bóvedas" });

    if (rows.length === 0) {
      const emptyEl = section.createDiv({ cls: "oc-empty" });
      emptyEl.innerHTML = `<svg class="oc-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${this.driveVaults === null ? "Google Drive no conectado." : "No hay bóvedas todavía."}</span>`;
      const createBtn = emptyEl.createEl("button", { cls: "oc-empty-create", text: "+ Crear bóveda desde esta vault" });
      createBtn.addEventListener("click", async () => {
        createBtn.disabled = true;
        try { await this.plugin.createBackendVaultFromCurrentVault(); await this.loadAndRender(); }
        catch (e) { new Notice("Error: " + e.message); createBtn.disabled = false; }
      });
    }

    for (const row of rows) {
      const vault = row.local;
      const vaultId = vault ? vault.id : null;
      const isActive = !!vaultId && vaultId === this.plugin.settings.selectedVaultId;
      const hasDrive = !!row.drive;
      const hasLocal = !!row.local;
      const displayName = (vault && vault.name) || (row.drive && row.drive.name) || "Sin nombre";
      const displaySlug = (vault && vault.slug) || "";

      const card = section.createDiv({ cls: "oc-vault-card" + (isActive ? " oc-active" : "") });

      const top = card.createDiv({ cls: "oc-vault-top" });
      top.innerHTML = `<svg class="oc-vault-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
      const meta = top.createDiv({ cls: "oc-vault-meta" });
      meta.createEl("div", { cls: "oc-vault-name", text: displayName });
      if (displaySlug) meta.createEl("div", { cls: "oc-vault-slug", text: displaySlug });

      const badges = card.createDiv({ cls: "oc-badges" });
      if (isActive) badges.createEl("span", { cls: "oc-badge oc-badge-active", text: "● Activa" });
      if (hasDrive) badges.createEl("span", { cls: "oc-badge oc-badge-drive", text: "Drive" });
      if (hasLocal) {
        const state = vault.sync_state || "idle";
        if (state === "synced") badges.createEl("span", { cls: "oc-badge oc-badge-synced", text: "✓ Sync" });
        else if (state === "pending") badges.createEl("span", { cls: "oc-badge oc-badge-pending", text: "⏳ Pendiente" });
        else badges.createEl("span", { cls: "oc-badge oc-badge-idle", text: state });
      }

      const actions = card.createDiv({ cls: "oc-vault-actions" });

      if (!isActive && hasLocal) {
        const selBtn = actions.createEl("button", { cls: "oc-card-btn", text: "Usar" });
        selBtn.title = "Vincular como bóveda activa";
        selBtn.addEventListener("click", async () => {
          this.plugin.settings.selectedVaultId = vault.id;
          this.plugin.settings.selectedVaultName = vault.name;
          await this.plugin.saveSettings();
          new Notice("Vault vinculada: " + vault.name);
          this.render();
        });
      }

      if (hasDrive && hasLocal) {
        const pshBtn = actions.createEl("button", { cls: "oc-card-btn" });
        pshBtn.innerHTML = `↑ Push`;
        pshBtn.title = "Subir cambios a Drive";
        pshBtn.addEventListener("click", async () => {
          pshBtn.disabled = true;
          try { await this.plugin.pushVault(vault.id); }
          catch (e) { new Notice("Error: " + e.message); }
          pshBtn.disabled = false;
        });
        const pllBtn = actions.createEl("button", { cls: "oc-card-btn" });
        pllBtn.innerHTML = `↓ Pull`;
        pllBtn.title = "Descargar cambios de Drive";
        pllBtn.addEventListener("click", async () => {
          pllBtn.disabled = true;
          try { await this.plugin.pullVault(vault.id); }
          catch (e) { new Notice("Error: " + e.message); }
          pllBtn.disabled = false;
        });
      } else if (!hasDrive && hasLocal) {
        const uploadBtn = actions.createEl("button", { cls: "oc-card-btn oc-card-btn-accent" });
        uploadBtn.innerHTML = `↑ Subir a Drive`;
        uploadBtn.addEventListener("click", async () => {
          uploadBtn.disabled = true;
          uploadBtn.textContent = "Subiendo...";
          try { await this.plugin.pushVaultToDrive(vault); await this.loadAndRender(); }
          catch (e) { new Notice("Error: " + e.message); uploadBtn.disabled = false; uploadBtn.textContent = "↑ Subir a Drive"; }
        });
      } else if (hasDrive && !hasLocal) {
        const importBtn = actions.createEl("button", { cls: "oc-card-btn oc-card-btn-accent" });
        importBtn.innerHTML = `↓ Importar de Drive`;
        importBtn.addEventListener("click", async () => {
          importBtn.disabled = true;
          importBtn.textContent = "Importando...";
          try { await this.plugin.importFromDrive(row.drive); await this.loadAndRender(); }
          catch (e) { new Notice("Error: " + e.message); importBtn.disabled = false; importBtn.textContent = "↓ Importar de Drive"; }
        });
      }
    }

    // ── Footer: timestamps ─────────────────────────────────────────
    const footer = containerEl.createDiv({ cls: "oc-footer" });
    const pullTs = footer.createDiv({ cls: "oc-ts" });
    pullTs.createEl("span", { cls: "oc-ts-lbl", text: "Pull " });
    pullTs.createEl("span", { text: formatTimestamp(this.plugin.settings.lastPullAt) });
    const pushTs = footer.createDiv({ cls: "oc-ts" });
    pushTs.createEl("span", { cls: "oc-ts-lbl", text: "Push " });
    pushTs.createEl("span", { text: formatTimestamp(this.plugin.settings.lastPushAt) });
  }
}

class ObsidianConnectSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "obsidianConnect" });

    new Setting(containerEl)
      .setName("Backend URL")
      .setDesc("Direccion base del backend FastAPI.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:8000")
          .setValue(this.plugin.settings.backendUrl)
          .onChange(async (value) => {
            this.plugin.settings.backendUrl = value.trim() || DEFAULT_SETTINGS.backendUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Email")
      .setDesc("Cuenta del backend para iniciar sesion desde el plugin.")
      .addText((text) =>
        text.setValue(this.plugin.settings.email).onChange(async (value) => {
          this.plugin.settings.email = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Contrasena")
      .setDesc("Se guarda en local solo para esta fase del plugin.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.password).onChange(async (value) => {
          this.plugin.settings.password = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Nombre del dispositivo")
      .setDesc("Identificador enviado al backend en la sincronizacion.")
      .addText((text) =>
        text.setValue(this.plugin.settings.deviceName).onChange(async (value) => {
          this.plugin.settings.deviceName = value.trim() || DEFAULT_SETTINGS.deviceName;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Prefijos excluidos")
      .setDesc("Rutas separadas por comas que no se sincronizan.")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.excludedPrefixes.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.excludedPrefixes = value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tamano de lote")
      .setDesc("Numero maximo de archivos por envio incremental.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.batchSize)).onChange(async (value) => {
          this.plugin.settings.batchSize = getBatchSize(Number(value));
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Espera OAuth")
      .setDesc("Segundos maximos para detectar que Google Drive quedo conectado.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.oauthPollSeconds)).onChange(async (value) => {
          this.plugin.settings.oauthPollSeconds = getOauthPollSeconds(Number(value));
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sesion del backend")
      .setDesc(
        this.plugin.settings.accessToken
          ? "Hay un token local listo para usar."
          : "Todavia no hay sesion iniciada."
      )
      .addButton((button) =>
        button.setButtonText("Login email").onClick(async () => {
          await this.plugin.login();
          this.display();
        })
      )
      .addButton((button) =>
        button.setCta().setButtonText("Login con Google").onClick(async () => {
          await this.plugin.loginWithGoogle();
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("Cerrar sesion").onClick(async () => {
          this.plugin.settings.accessToken = "";
          await this.plugin.saveSettings();
          new Notice("Token local eliminado.");
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Vault vinculado")
      .setDesc(
        this.plugin.settings.selectedVaultId
          ? this.plugin.settings.selectedVaultName +
              " (" +
              this.plugin.settings.selectedVaultId.slice(0, 8) +
              ")"
          : "Todavia no hay vault del backend seleccionado."
      )
      .addButton((button) =>
        button.setButtonText("Selector visual").onClick(async () => {
          await this.plugin.selectVault();
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("Crear desde esta boveda").onClick(async () => {
          await this.plugin.createBackendVaultFromCurrentVault();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Google Drive")
      .setDesc("Lanza la autorizacion OAuth para el vault seleccionado y espera la confirmacion.")
      .addButton((button) =>
        button.setCta().setButtonText("Conectar Google Drive").onClick(async () => {
          await this.plugin.connectGoogleDrive();
        })
      )
      .addButton((button) =>
        button.setButtonText("Abrir panel web").onClick(() => {
          this.plugin.openBackendWeb();
        })
      );

    new Setting(containerEl)
      .setName("Sincronizacion incremental")
      .setDesc(
        "Ultimo push: " +
          formatTimestamp(this.plugin.settings.lastPushAt) +
          " | Ultimo pull: " +
          formatTimestamp(this.plugin.settings.lastPullAt)
      )
      .addButton((button) =>
        button.setButtonText("Subir cambios").onClick(async () => {
          await this.plugin.pushVault();
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("Descargar cambios").onClick(async () => {
          await this.plugin.pullVault();
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("Reindexar cache").onClick(async () => {
          await this.plugin.refreshLocalSnapshot();
          await this.plugin.saveSettings();
          new Notice("Cache local reindexada.");
          this.display();
        })
      );
  }
}

class VaultBrowserModal extends Modal {
  constructor(app, plugin, items, onChoose, onDismiss) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.onChoose = onChoose;
    this.onDismiss = onDismiss;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-connect-vault-modal");

    const style = contentEl.createEl("style");
    style.textContent = `
      .obsidian-connect-vault-modal { padding:0 !important; }
      .oc-modal-header {
        padding:20px 24px 14px;
        border-bottom:1px solid var(--background-modifier-border);
      }
      .oc-modal-title { font-size:16px; font-weight:700; margin:0 0 4px; color:var(--text-normal); }
      .oc-modal-desc { font-size:12px; color:var(--text-muted); margin:0; line-height:1.5; }
      .oc-modal-list {
        padding:14px 20px 20px; display:flex; flex-direction:column; gap:8px;
        max-height:420px; overflow-y:auto;
      }
      .oc-modal-card {
        border:1px solid var(--background-modifier-border); border-radius:10px;
        padding:12px 14px; display:flex; align-items:center; gap:12px;
        background:var(--background-primary-alt); transition:border-color .15s;
      }
      .oc-modal-card:hover { border-color:var(--background-modifier-border-hover,var(--interactive-accent)); }
      .oc-modal-card.oc-modal-current {
        border-color:var(--interactive-accent);
        box-shadow:inset 3px 0 0 var(--interactive-accent);
      }
      .oc-modal-icon { color:var(--interactive-accent); flex-shrink:0; }
      .oc-modal-info { flex:1; min-width:0; }
      .oc-modal-name {
        font-size:13px; font-weight:600; color:var(--text-normal);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .oc-modal-meta {
        font-size:11px; color:var(--text-muted); margin-top:2px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .oc-modal-desc-text {
        font-size:11px; color:var(--text-faint); margin-top:1px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .oc-modal-badge-current {
        display:inline-block; margin-top:5px; font-size:10px; font-weight:600;
        padding:2px 7px; border-radius:20px;
        background:rgba(66,133,244,.15); color:var(--interactive-accent);
      }
      .oc-modal-select-btn {
        padding:6px 14px; border-radius:7px; cursor:pointer; font-size:12px;
        font-weight:600; border:none; background:var(--interactive-accent);
        color:var(--text-on-accent); flex-shrink:0; transition:filter .15s,transform .1s;
      }
      .oc-modal-select-btn:hover { filter:brightness(1.1); }
      .oc-modal-select-btn:active { transform:scale(.97); }
      .oc-modal-select-btn.oc-modal-btn-current {
        background:var(--background-secondary); color:var(--text-muted);
        border:1px solid var(--background-modifier-border);
        cursor:default;
      }
      .oc-modal-empty {
        text-align:center; padding:24px; color:var(--text-muted); font-size:13px;
      }
    `;

    const header = contentEl.createDiv({ cls: "oc-modal-header" });
    header.createEl("h2", { cls: "oc-modal-title", text: "Seleccionar bóveda" });
    header.createEl("p", { cls: "oc-modal-desc", text: "Elige el vault del backend que quieres vincular con esta bóveda de Obsidian." });

    this.listEl = contentEl.createDiv({ cls: "oc-modal-list" });
    this.renderList();
  }

  renderList() {
    this.listEl.empty();

    if (!this.items.length) {
      this.listEl.createDiv({ cls: "oc-modal-empty", text: "No hay vaults en el backend." });
      return;
    }

    this.items.forEach((item) => {
      const isCurrent = item.id === this.plugin.settings.selectedVaultId;
      const card = this.listEl.createDiv({ cls: "oc-modal-card" + (isCurrent ? " oc-modal-current" : "") });

      card.innerHTML = `<svg class="oc-modal-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

      const info = card.createDiv({ cls: "oc-modal-info" });
      info.createEl("div", { cls: "oc-modal-name", text: item.name || "Sin nombre" });
      const metaParts = [];
      if (item.slug) metaParts.push(item.slug);
      if (item.sync_state) metaParts.push(item.sync_state);
      if (metaParts.length) info.createEl("div", { cls: "oc-modal-meta", text: metaParts.join(" · ") });
      if (item.description) info.createEl("div", { cls: "oc-modal-desc-text", text: item.description });
      if (isCurrent) info.createEl("span", { cls: "oc-modal-badge-current", text: "● Vinculada actualmente" });

      const btn = card.createEl("button", {
        cls: "oc-modal-select-btn" + (isCurrent ? " oc-modal-btn-current" : ""),
        text: isCurrent ? "Activa" : "Seleccionar",
      });
      if (!isCurrent) {
        btn.addEventListener("click", async () => {
          await this.onChoose(item);
          this.close();
        });
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (typeof this.onDismiss === "function") {
      this.onDismiss();
      this.onDismiss = null;
    }
  }
}

function buildUrl(baseUrl, path, query) {
  const normalizedBase = String(baseUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : "/" + path;
  const url = new URL(normalizedBase + normalizedPath);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

function parseJsonResponse(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { detail: text };
  }
}

function slugify(value) {
  return String(value || "vault")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "vault";
}

function getMimeType(extension) {
  const ext = String(extension || "").toLowerCase();
  const map = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}

function isTextFile(extension, mimeType) {
  const ext = String(extension || "").toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    ["md", "txt", "json", "csv", "js", "ts", "css", "html", "yaml", "yml"].includes(ext)
  );
}

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function base64ToArrayBuffer(value) {
  return Uint8Array.from(Buffer.from(value, "base64")).buffer;
}

async function ensureParentFolder(app, path) {
  const parts = normalizePath(path).split("/");
  parts.pop();
  let current = "";

  for (const part of parts) {
    current = current ? current + "/" + part : part;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

function getVaultBasePath(app) {
  const adapter = app.vault.adapter;
  if (adapter && typeof adapter.getBasePath === "function") {
    return adapter.getBasePath();
  }
  return "";
}

function normalizeExcludedPrefixes(value) {
  const list = Array.isArray(value) ? value : DEFAULT_SETTINGS.excludedPrefixes;
  return list
    .map((item) => trimTrailingSlash(normalizePath(String(item || ""))) + "/")
    .filter((item) => item !== "/");
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SETTINGS.batchSize;
  }
  return Math.min(Math.floor(parsed), 200);
}

function getOauthPollSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 15) {
    return DEFAULT_SETTINGS.oauthPollSeconds;
  }
  return Math.min(Math.floor(parsed), 600);
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function ensureObject(value) {
  return value && typeof value === "object" ? value : {};
}

function getLocalSignature(file) {
  return {
    mtime: Number(file.stat.mtime || 0),
    size: Number(file.stat.size || 0),
  };
}

function getRemoteSignature(file) {
  return {
    remote_version: file.remote_version || "",
    modified_at: file.modified_at || "",
    size_bytes: Number(file.size_bytes || 0),
    content_hash: file.content_hash || "",
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "nunca";
  }
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}

function openExternalUrl(url) {
  try {
    const electron = require("electron");
    if (electron && electron.shell && typeof electron.shell.openExternal === "function") {
      electron.shell.openExternal(url);
      return;
    }
  } catch (_error) {
    // Fallback to the browser below.
  }

  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(url, "_blank");
  }
}

function generateNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
