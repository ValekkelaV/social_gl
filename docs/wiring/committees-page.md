# Подключение CommitteesPage

## `frontend/src/App.jsx`

Добавить импорт:
```jsx
import CommitteesPage from "./pages/CommitteesPage";
```

Добавить роут (рядом с остальными защищёнными):
```jsx
<Route path="/committees" element={<CommitteesPage />} />
```

## `frontend/src/layout/NavShell.jsx`

Добавить пункт в `NAV_ITEMS`:
```jsx
{ to: "/committees", label: "Комитеты" },
```
(Можно поставить в конец списка — раздел административный, не по MVP-приоритету
основных разделов.)

## Файл компонента

Положить `CommitteesPage.jsx` в `frontend/src/pages/`.
