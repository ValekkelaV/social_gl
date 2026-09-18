# Подключение обновлённого ApplicationsPage

## `frontend/src/App.jsx`

Заменить:
```jsx
<Route path="/applications" element={<ApplicationsPage />} />
```
на (добавить `/*`, т.к. теперь внутри страницы свои вложенные роуты — список/деталь/сводка):
```jsx
<Route path="/applications/*" element={<ApplicationsPage />} />
```

Остальное — без изменений. Файл компонента заменяет существующий
`frontend/src/pages/ApplicationsPage.jsx` целиком.
