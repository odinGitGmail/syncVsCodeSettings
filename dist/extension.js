"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const STATE_KEYS = {
    provider: 'syncVsCodeSettings.provider',
    repoOwner: 'syncVsCodeSettings.repoOwner',
    repoName: 'syncVsCodeSettings.repoName',
    branch: 'syncVsCodeSettings.branch',
    profileId: 'syncVsCodeSettings.profileId',
    profileDisplayName: 'syncVsCodeSettings.profileDisplayName'
};
const SECRET_KEYS = {
    token: 'syncVsCodeSettings.token'
};
function sha256(s) {
    return crypto.createHash('sha256').update(s).digest('hex');
}
function nowIso() {
    return new Date().toISOString();
}
function normalizeRepoPath(p) {
    return p.replace(/^\/+/, '').replace(/\\/g, '/');
}
function encodePathForUrl(p) {
    // Encode each segment, but keep slashes as path separators
    return normalizeRepoPath(p)
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
}
function base64EncodeUtf8(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}
function base64DecodeUtf8(b64) {
    return Buffer.from(b64, 'base64').toString('utf8');
}
async function fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = undefined;
    try {
        json = text ? JSON.parse(text) : undefined;
    }
    catch {
        // ignore
    }
    if (!res.ok) {
        const msg = json?.message || json?.error_description || json?.error || text || `${res.status} ${res.statusText}`;
        throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return json;
}
class GitHubProvider {
    token;
    kind = 'github';
    constructor(token) {
        this.token = token;
    }
    async getViewerLogin() {
        const json = await fetchJson('https://api.github.com/user', {
            method: 'GET',
            headers: {
                Authorization: `token ${this.token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'odinsam-syncvscodesettings'
            }
        });
        return json.login;
    }
    async getDefaultBranch(owner, repo) {
        const json = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
            method: 'GET',
            headers: {
                Authorization: `token ${this.token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'odinsam-syncvscodesettings'
            }
        });
        return json.default_branch || 'main';
    }
    async ensureRepo(owner, repo, isPrivate) {
        // Check if repo exists
        try {
            await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
                method: 'GET',
                headers: {
                    Authorization: `token ${this.token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'odinsam-syncvscodesettings'
                }
            });
            return;
        }
        catch {
            // continue to create
        }
        await fetchJson('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                Authorization: `token ${this.token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'odinsam-syncvscodesettings',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: repo,
                private: isPrivate,
                auto_init: true,
                description: 'Synced VSCode settings, keybindings, snippets, and extensions list.'
            })
        });
    }
    async readFile(ref, filePath) {
        const p = normalizeRepoPath(filePath);
        const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?ref=${encodeURIComponent(ref.branch)}`;
        try {
            const json = await fetchJson(url, {
                method: 'GET',
                headers: {
                    Authorization: `token ${this.token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'odinsam-syncvscodesettings'
                }
            });
            if (!json?.content)
                return undefined;
            return { content: base64DecodeUtf8(String(json.content).replace(/\n/g, '')), sha: json.sha };
        }
        catch (e) {
            // 404 => not found
            if (String(e?.message || '').includes('HTTP 404'))
                return undefined;
            throw e;
        }
    }
    async writeFile(ref, filePath, content, message) {
        const p = normalizeRepoPath(filePath);
        const getUrl = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?ref=${encodeURIComponent(ref.branch)}`;
        let sha = undefined;
        try {
            const existing = await fetchJson(getUrl, {
                method: 'GET',
                headers: {
                    Authorization: `token ${this.token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'odinsam-syncvscodesettings'
                }
            });
            sha = existing?.sha;
        }
        catch {
            // ignore
        }
        const putUrl = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}`;
        await fetchJson(putUrl, {
            method: 'PUT',
            headers: {
                Authorization: `token ${this.token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'odinsam-syncvscodesettings',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                content: base64EncodeUtf8(content),
                branch: ref.branch,
                ...(sha ? { sha } : {})
            })
        });
    }
    async listDir(ref, dirPath) {
        const p = normalizeRepoPath(dirPath);
        const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?ref=${encodeURIComponent(ref.branch)}`;
        try {
            const json = await fetchJson(url, {
                method: 'GET',
                headers: {
                    Authorization: `token ${this.token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'odinsam-syncvscodesettings'
                }
            });
            if (!Array.isArray(json))
                return [];
            return json.map((x) => ({ path: x.path, type: x.type === 'dir' ? 'dir' : 'file' }));
        }
        catch (e) {
            if (String(e?.message || '').includes('HTTP 404'))
                return [];
            throw e;
        }
    }
}
class GiteeProvider {
    token;
    kind = 'gitee';
    constructor(token) {
        this.token = token;
    }
    async getViewerLogin() {
        const json = await fetchJson(`https://gitee.com/api/v5/user?access_token=${encodeURIComponent(this.token)}`, {
            method: 'GET'
        });
        // login is gitee username (e.g. "odinsam")
        return json.login;
    }
    async getDefaultBranch(owner, repo) {
        const json = await fetchJson(`https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?access_token=${encodeURIComponent(this.token)}`, { method: 'GET' });
        // Gitee often defaults to "master" for new repos
        return json.default_branch || 'master';
    }
    async ensureRepo(owner, repo, isPrivate) {
        // check
        try {
            await fetchJson(`https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?access_token=${encodeURIComponent(this.token)}`, { method: 'GET' });
            return;
        }
        catch {
            // create
        }
        await fetchJson(`https://gitee.com/api/v5/user/repos?access_token=${encodeURIComponent(this.token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: repo,
                private: isPrivate,
                auto_init: true,
                description: 'Synced VSCode settings, keybindings, snippets, and extensions list.'
            })
        });
    }
    async readFile(ref, filePath) {
        const p = normalizeRepoPath(filePath);
        const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?access_token=${encodeURIComponent(this.token)}&ref=${encodeURIComponent(ref.branch)}`;
        try {
            const json = await fetchJson(url, { method: 'GET' });
            if (!json?.content)
                return undefined;
            return { content: base64DecodeUtf8(String(json.content).replace(/\n/g, '')), sha: json.sha };
        }
        catch (e) {
            if (String(e?.message || '').includes('HTTP 404'))
                return undefined;
            throw e;
        }
    }
    async writeFile(ref, filePath, content, message) {
        const p = normalizeRepoPath(filePath);
        const urlBase = `https://gitee.com/api/v5/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?access_token=${encodeURIComponent(this.token)}`;
        const tryOnce = async (branch) => {
            const url = `${urlBase}&branch=${encodeURIComponent(branch)}`;
            const getSha = async () => {
                const getUrl = `${urlBase}&ref=${encodeURIComponent(branch)}`;
                try {
                    const existing = await fetchJson(getUrl, { method: 'GET' });
                    return existing?.sha;
                }
                catch {
                    return undefined;
                }
            };
            const sha = await getSha();
            // Gitee API: create file => POST (no sha). Update file => PUT (requires sha).
            if (!sha) {
                try {
                    await fetchJson(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: base64EncodeUtf8(content),
                            message,
                            branch
                        })
                    });
                }
                catch (e) {
                    const msg = String(e?.message || '');
                    // If it already exists, retry as update (PUT) by re-fetching sha.
                    if (msg.includes('文件名已存在')) {
                        const sha2 = await getSha();
                        if (!sha2)
                            throw e;
                        await fetchJson(url, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                content: base64EncodeUtf8(content),
                                message,
                                branch,
                                sha: sha2
                            })
                        });
                    }
                    else {
                        throw e;
                    }
                }
                return;
            }
            await fetchJson(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: base64EncodeUtf8(content),
                    message,
                    branch,
                    sha
                })
            });
        };
        try {
            await tryOnce(ref.branch);
            return;
        }
        catch (e) {
            const msg = String(e?.message || '');
            if (!msg.includes('只允许在分支上创建或更新文件'))
                throw e;
            // Fallback: try common default branches.
            const candidates = Array.from(new Set([ref.branch, 'main', 'master'])).filter(Boolean);
            for (const b of candidates) {
                try {
                    await tryOnce(b);
                    return;
                }
                catch (e2) {
                    const msg2 = String(e2?.message || '');
                    if (!msg2.includes('只允许在分支上创建或更新文件'))
                        throw e2;
                }
            }
            throw e;
        }
    }
    async listDir(ref, dirPath) {
        const p = normalizeRepoPath(dirPath);
        const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodePathForUrl(p)}?access_token=${encodeURIComponent(this.token)}&ref=${encodeURIComponent(ref.branch)}`;
        try {
            const json = await fetchJson(url, { method: 'GET' });
            if (!Array.isArray(json))
                return [];
            return json.map((x) => ({ path: x.path, type: x.type === 'dir' ? 'dir' : 'file' }));
        }
        catch (e) {
            if (String(e?.message || '').includes('HTTP 404'))
                return [];
            throw e;
        }
    }
}
function getConfig() {
    return vscode.workspace.getConfiguration('syncVsCodeSettings');
}
class StatusBarController {
    item;
    busyCount = 0;
    constructor(item) {
        this.item = item;
    }
    setIdle() {
        this.item.text = '$(sync)';
        this.item.tooltip = '同步vscode配置';
    }
    setBusy(label) {
        this.item.text = '$(sync~spin)';
        this.item.tooltip = '同步vscode配置';
    }
    async run(label, fn) {
        this.busyCount += 1;
        this.setBusy(label);
        try {
            return await fn();
        }
        finally {
            this.busyCount -= 1;
            if (this.busyCount <= 0) {
                this.busyCount = 0;
                this.setIdle();
            }
            else {
                this.setBusy();
            }
        }
    }
}
async function openStatusBarMenu(context) {
    const pick = await vscode.window.showQuickPick([
        { label: '$(key) Configure', command: 'syncVsCodeSettings.configure' },
        { label: '$(git-branch) Switch Profile', command: 'syncVsCodeSettings.switchProfile' },
        { label: '$(cloud-upload) Upload', command: 'syncVsCodeSettings.upload' },
        { label: '$(cloud-download) Download', command: 'syncVsCodeSettings.download' }
    ], { placeHolder: 'Sync VSCode Settings' });
    if (!pick)
        return;
    await vscode.commands.executeCommand(pick.command);
}
function inferUserDataDirFromProcessArgs() {
    const idx = process.argv.findIndex((a) => a === '--user-data-dir');
    if (idx >= 0 && process.argv[idx + 1])
        return process.argv[idx + 1];
    const prefixed = process.argv.find((a) => a.startsWith('--user-data-dir='));
    if (prefixed)
        return prefixed.split('=')[1];
    return undefined;
}
function defaultUserDataDir() {
    // Heuristic defaults for stable channel ("Code"). If user uses portable/user-data-dir, prefer the argv override.
    const platform = process.platform;
    if (platform === 'darwin')
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code');
    if (platform === 'win32')
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code');
    // linux
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Code');
}
async function getLocalUserDir() {
    const override = String(getConfig().get('localUserDataDir') || '').trim();
    const userDataDir = override || inferUserDataDirFromProcessArgs() || defaultUserDataDir();
    return path.join(userDataDir, 'User');
}
async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    }
    catch (e) {
        if (e?.code === 'ENOENT')
            return undefined;
        throw e;
    }
}
async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}
async function listSnippetFiles(snippetsDir) {
    try {
        const ents = await fs.readdir(snippetsDir, { withFileTypes: true });
        return ents.filter((e) => e.isFile()).map((e) => path.join(snippetsDir, e.name));
    }
    catch (e) {
        if (e?.code === 'ENOENT')
            return [];
        throw e;
    }
}
function safeJsonParse(s, fallback) {
    try {
        return JSON.parse(s);
    }
    catch {
        return fallback;
    }
}
async function snapshotExtensions() {
    const exts = vscode.extensions.all
        .map((e) => ({
        id: e.id,
        version: e.packageJSON?.version,
        isBuiltin: Boolean(e.packageJSON?.isBuiltin)
    }))
        .filter((e) => !e.isBuiltin);
    return {
        schemaVersion: 1,
        generatedAt: nowIso(),
        extensions: exts.sort((a, b) => a.id.localeCompare(b.id))
    };
}
async function installExtensions(snapshot) {
    // Best-effort: install non-builtin extensions by id.
    for (const ext of snapshot.extensions) {
        try {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', ext.id);
        }
        catch {
            // ignore install errors (platform not supported / marketplace unavailable / etc)
        }
    }
}
async function getOrInitProfile(context) {
    const existingId = context.globalState.get(STATE_KEYS.profileId);
    const existingName = context.globalState.get(STATE_KEYS.profileDisplayName);
    if (existingId && existingName)
        return { id: existingId, displayName: existingName };
    const id = crypto.randomUUID();
    const displayName = 'default';
    await context.globalState.update(STATE_KEYS.profileId, id);
    await context.globalState.update(STATE_KEYS.profileDisplayName, displayName);
    return { id, displayName };
}
async function getProvider(context) {
    const kind = context.globalState.get(STATE_KEYS.provider);
    const token = await context.secrets.get(SECRET_KEYS.token);
    if (!kind || !token)
        throw new Error('Not configured. Run "Sync VSCode Settings: Configure" first.');
    return kind === 'github' ? new GitHubProvider(token) : new GiteeProvider(token);
}
async function getRepoRef(context, provider) {
    const cfg = getConfig();
    const repoName = String(cfg.get('repoName') || 'vscode-settings-sync');
    const owner = context.globalState.get(STATE_KEYS.repoOwner) || (await provider.getViewerLogin());
    const branch = context.globalState.get(STATE_KEYS.branch) || '';
    await context.globalState.update(STATE_KEYS.repoOwner, owner);
    await context.globalState.update(STATE_KEYS.repoName, repoName);
    if (branch)
        await context.globalState.update(STATE_KEYS.branch, branch);
    return { owner, repo: repoName, branch: branch || 'main' };
}
async function ensureRemoteReady(context, provider) {
    const ref0 = await getRepoRef(context, provider);
    await provider.ensureRepo(ref0.owner, ref0.repo, true);
    // Resolve correct default branch (especially for Gitee: "master" vs "main")
    const stored = context.globalState.get(STATE_KEYS.branch);
    const branch = stored && stored.trim() ? stored : await provider.getDefaultBranch(ref0.owner, ref0.repo);
    await context.globalState.update(STATE_KEYS.branch, branch);
    return { ...ref0, branch };
}
async function listRemoteProfiles(provider, ref, basePath) {
    const items = await provider.listDir(ref, basePath);
    const dirs = items.filter((x) => x.type === 'dir').map((x) => x.path);
    const results = [];
    for (const dirFullPath of dirs) {
        const id = path.posix.basename(dirFullPath);
        const metaPath = path.posix.join(dirFullPath.replace(/\\/g, '/'), 'meta.json');
        const metaFile = await provider.readFile(ref, metaPath);
        if (!metaFile)
            continue;
        const meta = safeJsonParse(metaFile.content, undefined);
        if (meta?.schemaVersion === 1 && meta?.id)
            results.push({ id, meta });
    }
    return results;
}
async function upload(context) {
    const provider = await getProvider(context);
    const ref = await ensureRemoteReady(context, provider);
    const basePath = String(getConfig().get('basePath') || 'profiles');
    const profile = await getOrInitProfile(context);
    const localUserDir = await getLocalUserDir();
    const settingsPath = path.join(localUserDir, 'settings.json');
    const keybindingsPath = path.join(localUserDir, 'keybindings.json');
    const snippetsDir = path.join(localUserDir, 'snippets');
    const settings = (await readTextIfExists(settingsPath)) ?? '{}\n';
    const keybindings = (await readTextIfExists(keybindingsPath)) ?? '[]\n';
    const snippetFiles = await listSnippetFiles(snippetsDir);
    const exts = await snapshotExtensions();
    const profileDir = path.posix.join(basePath, profile.id);
    const meta = {
        schemaVersion: 1,
        id: profile.id,
        displayName: profile.displayName,
        createdAt: nowIso(),
        lastSyncAt: nowIso(),
        platform: process.platform,
        vscodeVersion: vscode.version
    };
    await provider.writeFile(ref, path.posix.join(profileDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', `Update meta for ${profile.displayName}`);
    await provider.writeFile(ref, path.posix.join(profileDir, 'settings.json'), settings, `Update settings for ${profile.displayName}`);
    await provider.writeFile(ref, path.posix.join(profileDir, 'keybindings.json'), keybindings, `Update keybindings for ${profile.displayName}`);
    await provider.writeFile(ref, path.posix.join(profileDir, 'extensions.json'), JSON.stringify(exts, null, 2) + '\n', `Update extensions for ${profile.displayName}`);
    for (const file of snippetFiles) {
        const content = await fs.readFile(file, 'utf8');
        const name = path.basename(file);
        await provider.writeFile(ref, path.posix.join(profileDir, 'snippets', name), content, `Update snippet ${name} for ${profile.displayName}`);
    }
    vscode.window.showInformationMessage(`Uploaded settings to ${provider.kind}:${ref.owner}/${ref.repo}/${profile.displayName}`);
}
async function download(context) {
    const provider = await getProvider(context);
    const ref = await ensureRemoteReady(context, provider);
    const basePath = String(getConfig().get('basePath') || 'profiles');
    const profile = await getOrInitProfile(context);
    const profileDir = path.posix.join(basePath, profile.id);
    const settingsFile = await provider.readFile(ref, path.posix.join(profileDir, 'settings.json'));
    const keybindingsFile = await provider.readFile(ref, path.posix.join(profileDir, 'keybindings.json'));
    const extsFile = await provider.readFile(ref, path.posix.join(profileDir, 'extensions.json'));
    const snippetsList = await provider.listDir(ref, path.posix.join(profileDir, 'snippets'));
    const localUserDir = await getLocalUserDir();
    await ensureDir(localUserDir);
    await ensureDir(path.join(localUserDir, 'snippets'));
    if (settingsFile)
        await fs.writeFile(path.join(localUserDir, 'settings.json'), settingsFile.content, 'utf8');
    if (keybindingsFile)
        await fs.writeFile(path.join(localUserDir, 'keybindings.json'), keybindingsFile.content, 'utf8');
    for (const item of snippetsList.filter((x) => x.type === 'file')) {
        const rf = await provider.readFile(ref, item.path);
        if (!rf)
            continue;
        const filename = path.basename(item.path);
        await fs.writeFile(path.join(localUserDir, 'snippets', filename), rf.content, 'utf8');
    }
    if (extsFile) {
        const snap = safeJsonParse(extsFile.content, { schemaVersion: 1, generatedAt: nowIso(), extensions: [] });
        await installExtensions(snap);
    }
    vscode.window.showInformationMessage(`Downloaded settings from ${provider.kind}:${ref.owner}/${ref.repo}/${profile.displayName}`);
}
async function configure(context) {
    const providerPick = await vscode.window.showQuickPick([
        { label: 'GitHub', providerKind: 'github' },
        { label: 'Gitee', providerKind: 'gitee' }
    ], { placeHolder: 'Choose provider (GitHub/Gitee)' });
    if (!providerPick)
        return;
    const token = await vscode.window.showInputBox({
        prompt: `${providerPick.label} Personal Access Token`,
        password: true,
        ignoreFocusOut: true
    });
    if (!token)
        return;
    await context.globalState.update(STATE_KEYS.provider, providerPick.providerKind);
    await context.secrets.store(SECRET_KEYS.token, token);
    const provider = providerPick.providerKind === 'github' ? new GitHubProvider(token) : new GiteeProvider(token);
    const login = await provider.getViewerLogin();
    await context.globalState.update(STATE_KEYS.repoOwner, login);
    // Ensure profile exists locally, but do NOT create remote files until first upload/download
    await getOrInitProfile(context);
    await ensureRemoteReady(context, provider);
    vscode.window.showInformationMessage(`Configured ${providerPick.label} as ${login}. Repo will be auto-created if missing.`);
}
async function switchProfile(context) {
    const provider = await getProvider(context);
    const ref = await ensureRemoteReady(context, provider);
    const basePath = String(getConfig().get('basePath') || 'profiles');
    const remoteProfiles = await listRemoteProfiles(provider, ref, basePath);
    const currentId = context.globalState.get(STATE_KEYS.profileId);
    const picks = [
        { label: '$(add) Create new profile', description: 'Create a new remote profile directory', action: 'create' }
    ];
    for (const p of remoteProfiles.sort((a, b) => (a.meta.displayName || a.id).localeCompare(b.meta.displayName || b.id))) {
        picks.push({
            label: p.meta.displayName || p.id,
            description: p.id === currentId ? 'current' : undefined,
            detail: `lastSyncAt: ${p.meta.lastSyncAt || 'never'}`,
            id: p.id
        });
    }
    const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a profile' });
    if (!pick)
        return;
    if (pick.action === 'create') {
        const displayName = await vscode.window.showInputBox({ prompt: 'Profile display name (e.g. vue / csharp)', ignoreFocusOut: true });
        if (!displayName)
            return;
        // create deterministic-ish id: sha(displayName + random) shortened
        const id = sha256(`${displayName}:${crypto.randomUUID()}`).slice(0, 12);
        const meta = {
            schemaVersion: 1,
            id,
            displayName,
            createdAt: nowIso(),
            platform: process.platform,
            vscodeVersion: vscode.version
        };
        const profileDir = path.posix.join(basePath, id);
        await provider.writeFile(ref, path.posix.join(profileDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', `Create profile ${displayName}`);
        await context.globalState.update(STATE_KEYS.profileId, id);
        await context.globalState.update(STATE_KEYS.profileDisplayName, displayName);
        vscode.window.showInformationMessage(`Switched to profile: ${displayName}`);
        return;
    }
    if (pick.id) {
        const matched = remoteProfiles.find((p) => p.id === pick.id);
        await context.globalState.update(STATE_KEYS.profileId, pick.id);
        await context.globalState.update(STATE_KEYS.profileDisplayName, matched?.meta.displayName || pick.label);
        vscode.window.showInformationMessage(`Switched to profile: ${matched?.meta.displayName || pick.label}`);
    }
}
function activate(context) {
    const statusBarEnabled = Boolean(getConfig().get('statusBar.enabled'));
    let statusBar = undefined;
    if (statusBarEnabled) {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        item.text = '$(sync)';
        item.tooltip = '同步vscode配置';
        item.command = 'syncVsCodeSettings.statusBarMenu';
        item.show();
        statusBar = new StatusBarController(item);
        statusBar.setIdle();
        context.subscriptions.push(item);
    }
    const wrap = (label, fn) => async () => {
        if (statusBar)
            return await statusBar.run(label, fn);
        return await fn();
    };
    context.subscriptions.push(vscode.commands.registerCommand('syncVsCodeSettings.statusBarMenu', () => openStatusBarMenu(context)), vscode.commands.registerCommand('syncVsCodeSettings.configure', wrap('Configuring...', () => configure(context))), vscode.commands.registerCommand('syncVsCodeSettings.switchProfile', wrap('Switching profile...', () => switchProfile(context))), vscode.commands.registerCommand('syncVsCodeSettings.upload', wrap('Uploading...', () => upload(context))), vscode.commands.registerCommand('syncVsCodeSettings.download', wrap('Downloading...', () => download(context))));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map