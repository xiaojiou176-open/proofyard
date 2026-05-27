import { memo } from "react"

interface EvidenceScreenshotPairProps {
  beforeImageUrl: string | null | undefined
  afterImageUrl: string | null | undefined
  beforeAlt: string
  afterAlt: string
  beforeLabel?: string
  afterLabel?: string
  emptyHint?: string
}

function EvidenceScreenshotPair({
  beforeImageUrl,
  afterImageUrl,
  beforeAlt,
  afterAlt,
  beforeLabel = "Before",
  afterLabel = "After",
  emptyHint,
}: EvidenceScreenshotPairProps) {
  const hasAnyScreenshot = Boolean(beforeImageUrl || afterImageUrl)
  const resolvedBeforeAlt = beforeAlt.trim() || `${beforeLabel} step evidence image`
  const resolvedAfterAlt = afterAlt.trim() || `${afterLabel} step evidence image`

  return (
    <>
      <div className="evidence-grid">
        {beforeImageUrl && (
          <div>
            <p className="hint-text">{beforeLabel}</p>
            <img src={beforeImageUrl} alt={resolvedBeforeAlt} className="evidence-img" />
          </div>
        )}
        {afterImageUrl && (
          <div>
            <p className="hint-text">{afterLabel}</p>
            <img src={afterImageUrl} alt={resolvedAfterAlt} className="evidence-img" />
          </div>
        )}
      </div>
      {!hasAnyScreenshot && emptyHint && <p className="hint-text">{emptyHint}</p>}
    </>
  )
}

export default memo(EvidenceScreenshotPair)
