# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

Time Zone setting
-----------------

This app now supports a global Time Zone setting (Settings → General → Time zone). Choose `Auto` to keep the browser-local display or pick an IANA time zone (for example `UTC`, `America/New_York`, `Europe/London`).

Implementation notes:
- The selected value is persisted server-side in `app_settings.general.timezone` and propagated to clients on save.
- The frontend formats displayed dates/times using `frontend/src/lib/timezone.js` which uses `Intl.DateTimeFormat` and the `timeZone` option. When `auto` is selected the browser's local timezone is used.

Reorder servers on the Server List
----------------------------------

Admins can rearrange the display order of servers and persist it to the database:

- Open the Server List page.
- Click the "Reorder" button in the toolbar above the list.
- Drag and drop items into the desired order (you’ll see a grab cursor and subtle highlight).
- Click "Save Order" to persist. Click "Cancel" to discard changes.

Details:

- Order is stored in the `servers.display_pos` column and used by the API (`GET /api/servers`) so it persists across sessions and devices.
- New servers are appended to the end of the list by default.
- Bulk reorder endpoint: `PUT /api/servers/order` with JSON body `{ "ids": [<serverId1>, <serverId2>, ...] }` (admin only).

Troubleshooting:

- If the list doesn’t reflect your new order, refresh the page. Ensure your account has admin privileges. If issues persist, verify the backend migration adding `display_pos` is applied and the server is restarted.
