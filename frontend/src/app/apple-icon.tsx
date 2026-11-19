import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

/**
 * Renders the 180x180 Apple touch icon matching KansoLogo's framed emblem.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #19191F 0%, #0A0A0D 100%)',
          borderRadius: 44,
          border: '6px solid rgba(255, 255, 255, 0.22)',
        }}
      >
        <svg width="132" height="132" viewBox="0 -1 24 24" fill="none">
          <rect x="4" y="4" width="4.5" height="7" rx="1" fill="#FFFFFF" />
          <rect x="10.5" y="4" width="3.5" height="12" rx="1" fill="#FFFFFF" />
          <rect x="16" y="7" width="4" height="5" rx="1" fill="#FFFFFF" />
          <circle cx="6.2" cy="15.5" r="1.7" fill="#FFFFFF" />
          <circle cx="17.8" cy="16.5" r="1.4" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
