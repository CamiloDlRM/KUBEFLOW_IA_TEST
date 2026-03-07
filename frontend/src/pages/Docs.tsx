import { useState } from 'react';
import { ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';
import { DocsSidebar, getSectionTitle, type DocSection } from '@/components/docs/DocsSidebar';
import { DocContent } from '@/components/docs/DocContent';

const sections: DocSection[] = ['intro', 'upload', 'test', 'metrics'];

export default function Docs() {
  const [active, setActive] = useState<DocSection>('intro');
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentIndex = sections.indexOf(active);
  const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

  return (
    <div className="min-h-screen bg-[#09090b] font-['Inter',sans-serif]">
      <DocsSidebar
        active={active}
        onNavigate={setActive}
        mobileOpen={mobileOpen}
        onMobileToggle={() => setMobileOpen(!mobileOpen)}
      />

      {/* Main content */}
      <div className="lg:pl-60">
        <div className="max-w-3xl mx-auto px-8 py-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm text-[#52525b] mb-8">
            <span>Docs</span>
            <ChevronRight size={14} />
            <span className="text-[#a1a1aa]">{getSectionTitle(active)}</span>
          </div>

          {/* Content */}
          <DocContent section={active} />

          {/* Bottom navigation */}
          <div className="flex items-center justify-between mt-12 pt-8 border-t border-[#27272a]">
            {prevSection ? (
              <button
                onClick={() => setActive(prevSection)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#27272a] text-[#a1a1aa] hover:text-white hover:border-[#52525b] transition-colors text-sm"
              >
                <ArrowLeft size={14} />
                {getSectionTitle(prevSection)}
              </button>
            ) : (
              <button
                disabled
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#27272a] text-[#52525b] cursor-not-allowed text-sm"
              >
                <ArrowLeft size={14} />
                Anterior
              </button>
            )}

            {nextSection ? (
              <button
                onClick={() => setActive(nextSection)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#27272a] text-white hover:border-[#52525b] transition-colors text-sm"
              >
                {getSectionTitle(nextSection)}
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                disabled
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#27272a] text-[#52525b] cursor-not-allowed text-sm"
              >
                Siguiente
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
