import { Suspense } from "react";
import { TodoApp } from "@/components/todo-app";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="auth-loading">todoer</div>}>
        <TodoApp />
      </Suspense>
      {children}
    </>
  );
}
