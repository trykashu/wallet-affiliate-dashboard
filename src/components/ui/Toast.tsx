"use client";

import { useEffect } from "react";

export interface ToastMessage {
  id: string;
  title: string;
  body?: string;
  type: "info" | "success" | "error";
}

interface ToastContainerProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ messages, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {messages.map((msg) => (
        <Toast key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ message, onDismiss }: { message: ToastMessage; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), 5000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  return (
    <div className="pointer-events-auto bg-white border border-surface-200 rounded-2xl shadow-card-md px-4 py-3 max-w-xs animate-slide-up">
      <p className="text-xs font-semibold text-gray-900">{message.title}</p>
      {message.body && (
        <p className="text-[10px] text-brand-400 mt-0.5">{message.body}</p>
      )}
    </div>
  );
}
