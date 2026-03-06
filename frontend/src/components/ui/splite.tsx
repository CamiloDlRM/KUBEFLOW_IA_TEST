'use client'
import { Suspense, lazy, useState, useCallback } from 'react'
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
  onLoad?: () => void
}

function SplineSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <div className="w-full h-full relative">
        <div
          className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 animate-pulse"
          style={{
            backgroundSize: '200% 100%',
            animation: 'shimmer 2s ease-in-out infinite',
          }}
        />
        <style>{`
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
        {/* Robot silhouette hint */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full bg-zinc-800/50 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

export function SplineScene({ scene, className, onLoad }: SplineSceneProps) {
  const [loaded, setLoaded] = useState(false)

  const handleLoad = useCallback(() => {
    setLoaded(true)
    onLoad?.()
  }, [onLoad])

  return (
    <Suspense fallback={<SplineSkeleton />}>
      {!loaded && (
        <div className="absolute inset-0 z-10">
          <SplineSkeleton />
        </div>
      )}
      <div
        className={`transition-opacity duration-700 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
        style={{ width: '100%', height: '100%' }}
      >
        <Spline scene={scene} className={className} onLoad={handleLoad} />
      </div>
    </Suspense>
  )
}
