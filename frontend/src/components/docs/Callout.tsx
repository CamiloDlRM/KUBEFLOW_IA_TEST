import { type ReactNode } from 'react';

interface CalloutProps {
  label: string;
  children: ReactNode;
}

export function Callout({ label, children }: CalloutProps) {
  return (
    <div className="border-l-[3px] border-white bg-[#18181b]/50 rounded-r-lg px-5 py-4 my-6">
      <p className="text-[#a1a1aa] text-sm leading-relaxed">
        <span className="font-bold text-white">{label}: </span>
        {children}
      </p>
    </div>
  );
}
