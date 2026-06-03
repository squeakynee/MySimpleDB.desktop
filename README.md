# MySimpleDB.desktop

MySimpleDB Desktop is the Electron-based desktop companion app for MySimpleDB, providing local attachment sync, offline-capable workflows, desktop notifications, and secure native OS integration using Electron, React, and SQLite.

## Features

* Electron desktop application
* React-based desktop UI
* Local SQLite attachment sync database
* Secure local attachment tracking
* Native desktop window integration
* Desktop notifications and OS integration
* Foundation for offline attachment sync workflows

## Tech Stack

* Electron
* React
* TypeScript
* SQLite
* better-sqlite3
* Vite

## Project Structure

```text
electron/
  main.ts
  preload.ts
  sync/
    syncDb.cjs

src/
  components/
  auth/
  utils/
```

## Local Sync Database

The desktop app maintains a local SQLite database used for attachment sync tracking.

Current table:

```text
synced_attachments
```

The database is stored under the Electron application support folder.

Example macOS location:

```text
~/Library/Application Support/MySimpleDB/mysimpledb-sync.sqlite
```

## Development Setup

### Install dependencies

```bash
npm install
```

### Rebuild native SQLite module for Electron

```bash
npm install --save-dev electron-rebuild
npx electron-rebuild -f -w better-sqlite3
```

### Run development environment

```bash
npm run dev
```

## Verify Local SQLite Database

```bash
sqlite3 "~/Library/Application Support/MySimpleDB/mysimpledb-sync.sqlite"
```

Useful SQLite commands:

```sql
.tables
.schema synced_attachments
SELECT * FROM synced_attachments;
```

## Current Status

Day 1–2 foundation completed:

* Electron desktop app setup
* Local SQLite sync database
* Electron/CommonJS integration
* Native module rebuild process
* Attachment sync schema initialization

## Planned Features

* Local attachment sync
* Attachment version tracking
* Background sync service
* Offline attachment access
* Bidirectional attachment updates
* Sync conflict detection
* Desktop drag/drop sync workflows
* Local file monitoring
* Secure encrypted attachment storage

## License

Private repository — all rights reserved.

