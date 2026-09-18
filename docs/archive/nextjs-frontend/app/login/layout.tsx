// frontend/app/login/layout.tsx
//
// Отдельный layout для /login — без сайдбара, т.к. пока не залогинен,
// показывать разделы админки нет смысла.

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      {children}
    </div>
  );
}
