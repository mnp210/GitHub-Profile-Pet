import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

export const PawIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    {/* Main pad */}
    <rect x="4" y="9" width="8" height="5" />
    <rect x="3" y="10" width="10" height="3" />
    {/* Toe pads */}
    <rect x="2" y="5" width="3" height="3" />
    <rect x="6" y="3" width="4" height="3" />
    <rect x="11" y="5" width="3" height="3" />
  </svg>
);

export const FlameIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="7" y="1" width="2" height="3" />
    <rect x="5" y="4" width="6" height="4" />
    <rect x="3" y="7" width="10" height="5" />
    <rect x="4" y="12" width="8" height="3" />
    <rect x="6" y="8" width="4" height="4" fill="#fbbf24" />
  </svg>
);

export const CommitIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="1" y="7" width="4" height="2" />
    <rect x="11" y="7" width="4" height="2" />
    <rect x="5" y="4" width="6" height="8" />
    <rect x="4" y="5" width="8" height="6" />
    <rect x="6" y="6" width="4" height="4" fill="#0f172a" />
  </svg>
);

export const TrophyIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="3" y="2" width="10" height="6" />
    <rect x="1" y="3" width="2" height="4" />
    <rect x="13" y="3" width="2" height="4" />
    <rect x="5" y="8" width="6" height="3" />
    <rect x="7" y="11" width="2" height="2" />
    <rect x="4" y="13" width="8" height="2" />
  </svg>
);

export const ActivityIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="1" y="8" width="3" height="2" />
    <rect x="4" y="5" width="2" height="5" />
    <rect x="6" y="2" width="2" height="6" />
    <rect x="8" y="7" width="2" height="7" />
    <rect x="10" y="4" width="2" height="7" />
    <rect x="12" y="8" width="3" height="2" />
  </svg>
);

export const GitHubIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="4" y="1" width="8" height="2" />
    <rect x="2" y="3" width="12" height="3" />
    <rect x="1" y="6" width="14" height="5" />
    <rect x="2" y="11" width="12" height="3" />
    <rect x="5" y="14" width="6" height="1" />
    {/* Mask cutouts for eyes */}
    <rect x="4" y="7" width="2" height="2" fill="#0f1523" />
    <rect x="10" y="7" width="2" height="2" fill="#0f1523" />
    {/* Whiskers */}
    <rect x="7" y="9" width="2" height="2" fill="#0f1523" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="6" y="1" width="4" height="14" />
    <rect x="1" y="6" width="14" height="4" />
    <rect x="3" y="3" width="10" height="10" />
    <rect x="6" y="6" width="4" height="4" fill="#0f1523" />
  </svg>
);

export const AwardIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="5" y="1" width="6" height="8" />
    <rect x="4" y="2" width="8" height="6" />
    <rect x="6" y="3" width="4" height="4" fill="#fbbf24" />
    <rect x="4" y="9" width="3" height="6" />
    <rect x="9" y="9" width="3" height="6" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="12" y="1" width="3" height="3" />
    <rect x="9" y="4" width="3" height="3" />
    <rect x="6" y="7" width="3" height="3" />
    <rect x="3" y="10" width="3" height="3" />
    <rect x="1" y="13" width="3" height="2" />
    <rect x="2" y="12" width="2" height="3" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="12" y="3" width="2" height="3" />
    <rect x="10" y="6" width="2" height="3" />
    <rect x="8" y="9" width="2" height="3" />
    <rect x="6" y="7" width="2" height="3" />
    <rect x="4" y="5" width="2" height="3" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="2" y="2" width="3" height="3" />
    <rect x="11" y="2" width="3" height="3" />
    <rect x="5" y="5" width="6" height="6" />
    <rect x="2" y="11" width="3" height="3" />
    <rect x="11" y="11" width="3" height="3" />
  </svg>
);

export const MenuIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="2" y="3" width="12" height="2" />
    <rect x="2" y="7" width="12" height="2" />
    <rect x="2" y="11" width="12" height="2" />
  </svg>
);

export const HeartIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="2" y="3" width="4" height="4" fill="#f43f5e" />
    <rect x="10" y="3" width="4" height="4" fill="#f43f5e" />
    <rect x="1" y="4" width="14" height="5" fill="#f43f5e" />
    <rect x="3" y="9" width="10" height="3" fill="#f43f5e" />
    <rect x="6" y="12" width="4" height="2" fill="#f43f5e" />
    <rect x="7" y="14" width="2" height="1" fill="#f43f5e" />
    <rect x="3" y="4" width="1" height="2" fill="#fff" />
  </svg>
);

export const BoltIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="7" y="1" width="4" height="4" fill="#facc15" />
    <rect x="5" y="5" width="7" height="3" fill="#facc15" />
    <rect x="4" y="8" width="6" height="3" fill="#facc15" />
    <rect x="5" y="11" width="3" height="4" fill="#facc15" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="6" y="2" width="6" height="2" />
    <rect x="4" y="4" width="4" height="2" />
    <rect x="3" y="6" width="3" height="4" />
    <rect x="4" y="10" width="4" height="2" />
    <rect x="6" y="12" width="6" height="2" />
    <rect x="10" y="4" width="3" height="8" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} shapeRendering="crispEdges">
    <rect x="4" y="2" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="2" y="5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
