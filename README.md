# OdinSam 同步 VSCode 配置（GitHub / Gitee）

[![License](https://img.shields.io/badge/License-Unlicense-blue.svg)](https://unlicense.org)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)
![Version](https://img.shields.io/visual-studio-marketplace/v/odinsam.odinsam-syncvscodesettings)
[![Author](https://img.shields.io/badge/Author-odinsam-success)](https://www.odinsam.com)

一个轻量的 VSCode 扩展：将你的 **用户级配置** 同步到 **GitHub** 或 **Gitee**，并通过“配置集（Profile）”实现 **同账号、多 VSCode 实例** 互不覆盖。

## 你能得到什么

- **同步内容精简但够用**（不碰缓存/最近文件/隐私敏感数据）：
  - `settings.json`
  - `keybindings.json`
  - `snippets/*`
  - **已安装扩展列表**（扩展 ID 列表；下载时自动安装，best-effort）
- **单仓库、单分支、多目录**：一个仓库就能管理多个“配置集”
- **多实例不互相覆盖**：同一个 GitHub/Gitee 账号下，你可以为 `C#` / `Vue` / `Work` / `Home` 等环境分别维护配置集
- **状态栏按钮**：右下角一个 `$(sync)` 图标，执行中会变成 `$(sync~spin)`

> 截图/动图：你可以在发布到市场前补一张状态栏按钮与菜单的截图。

## 同步原理（很重要）

本扩展使用 **单仓库 / 单分支** 存储，并用 **目录** 隔离不同配置集（Profile）：

`profiles/<profileId>/...`

每个 Profile 都是一套独立的配置文件，因此不会互相覆盖。

## 快速开始（3 步）

1. 打开命令面板（macOS：`⇧⌘P`，Windows/Linux：`Ctrl+Shift+P`）
2. 执行 **Sync VSCode Settings: Configure (GitHub/Gitee Token)**
   - 选择 **GitHub** 或 **Gitee**
   - 粘贴你的 Token（将保存到 VSCode Secret Storage）
   - 扩展会自动创建/复用远端仓库（默认私有）
3. 执行 **Sync VSCode Settings: Upload** 上传当前配置

在另一台机器（或另一个 VSCode 实例）：

- 配置 Token 后，执行 **Download** 即可拉取并应用配置。

## 命令说明

- **Sync VSCode Settings: Configure (GitHub/Gitee Token)**
  - 选择平台（GitHub / Gitee）
  - 输入 Token（保存在 VSCode Secret Storage）
  - 自动创建/复用仓库
- **Sync VSCode Settings: Switch Profile**
  - 新建/选择一个配置集（Profile）
  - 推荐用 `vue`、`csharp`、`work`、`home` 这类命名
- **Sync VSCode Settings: Upload**
  - 上传当前 Profile 的：`settings.json` / `keybindings.json` / `snippets/*` / 扩展列表
- **Sync VSCode Settings: Download**
  - 下载并写入上述文件
  - 同时对扩展列表进行 **best-effort 安装**（安装失败会跳过）

## 状态栏按钮

右下角会显示一个图标按钮：

- **空闲**：`$(sync)`（鼠标悬停提示：同步 vscode 配置）
- **执行中**：`$(sync~spin)`（会转动）

点击图标会弹出菜单，快速执行 Configure / Switch Profile / Upload / Download。

## 远端仓库与目录结构

默认仓库名：`vscode-settings-sync`  
默认根目录：`profiles`

一个 Profile 的典型结构：

```text
profiles/
  <profileId>/
    meta.json
    settings.json
    keybindings.json
    extensions.json
    snippets/
      <name>.json
      <name>.code-snippets
```

- `meta.json`：Profile 元信息（展示名、创建时间、最近同步时间等）
- `extensions.json`：扩展列表快照（下载时会尝试安装）

## Token 权限建议（GitHub / Gitee）

为了实现“自动创建仓库 + 读写文件”，Token 需要具备：

- **创建仓库权限**
- **读写仓库内容权限**

如果你的 Token 没有创建仓库权限：

- 扩展可能无法自动创建仓库（会在调用 API 时返回 403/400）
- 你可以先手动创建仓库，再把仓库名配置为 `syncVsCodeSettings.repoName`

## 多 VSCode 实例（不同环境）如何使用

你可以把“配置集（Profile）”当成不同开发环境的配置桶：

- `vue`：前端环境（ESLint/Prettier/Vetur 等）
- `csharp`：.NET 环境（C# 扩展、调试器等）

**推荐流程：**

1. 在第一个 VSCode 实例里：`Switch Profile -> Create new profile -> vue`，然后 Upload
2. 在第二个 VSCode 实例里：`Switch Profile -> Create new profile -> csharp`，然后 Upload
3. 各自只在自己的 Profile 下 Upload/Download，互不覆盖

## 多 VSCode “安装目录” vs “用户数据目录”（避坑）

仅仅“安装目录不同”不一定代表配置隔离；真正决定配置文件位置的是 **user data dir**。

本扩展需要知道 VSCode 的 `User` 目录位置，默认会：

1. 尝试从进程参数里识别 `--user-data-dir`
2. 如果识别不到，使用系统默认路径（`Code/User`）

如果你确实是“多个 user-data-dir / Portable”，建议你在各实例中分别设置：

- `syncVsCodeSettings.localUserDataDir`

这样可以避免“推断到同一个 User 目录”，导致你以为是两个实例但其实读写同一份配置。

## 跨 OS 同步（macOS ↔ Windows ↔ Linux）

本扩展同步的文件在大多数情况下可以跨 OS 使用，但要注意：

- `settings.json` 中涉及 **路径/终端/字体/外部工具** 的配置可能需要按 OS 调整
- `keybindings.json` 在不同 OS 下快捷键语义不同（`cmd` vs `ctrl`），你可能需要做一些微调
- 扩展列表中某些扩展可能不支持当前平台（会被跳过）

建议：把 OS 强相关的设置尽量减少，或在不同 Profile 里分别维护。

## 常见问题（Troubleshooting）

- **HTTP 400: 只允许在分支上创建或更新文件**

  - 常见原因：目标分支不存在（例如仓库默认分支是 `master` 但你以为是 `main`）
  - 本扩展会自动读取仓库 `default_branch` 并进行写入；如果你手动改过默认分支，请重新执行一次 Configure。

- **HTTP 400: sha is missing / sha is empty**

  - 常见原因：更新文件时没有带上远端 sha
  - 本扩展在更新时会先读取 sha 再 PUT 更新

- **HTTP 400: 文件名已存在**

  - 常见原因：创建文件（POST）时远端已经存在同名文件
  - 本扩展会自动回退为更新（PUT）

- **扩展安装失败**
  - Marketplace 网络不可用、扩展不支持当前平台、或被公司策略禁止
  - 本扩展会跳过失败项；你可以手动安装缺失扩展

## 隐私与安全

- Token 存在 VSCode 的 **Secret Storage**（不会写入 settings.json / 仓库）
- 同步内容仅包含：`settings.json`、`keybindings.json`、`snippets/*`、扩展 ID 列表  
  不会同步扩展缓存、最近打开文件、各类数据库等高隐私内容

## 配置项（Settings）

- `syncVsCodeSettings.repoName`：远端仓库名（默认 `vscode-settings-sync`）
- `syncVsCodeSettings.basePath`：仓库内保存 Profile 的根目录（默认 `profiles`）
- `syncVsCodeSettings.localUserDataDir`：可选，手动指定 VSCode 的 `--user-data-dir`
- `syncVsCodeSettings.statusBar.enabled`：是否显示右下角状态栏按钮（默认 `true`）
