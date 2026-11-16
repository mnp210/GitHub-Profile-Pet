'use client';

import React, { useState } from 'react';
import { PixelButton } from '@/components/ui/PixelButton';
import { SettingsIcon, CheckIcon, CopyIcon } from '@/components/ui/PixelIcons';
import { UserAccountState } from '@/types/auth';
import { generateReadmeEmbedSnippet, getPublicAppUrl } from '@/lib/github/embedUtils';

interface SettingsViewProps {
  onResetPet: () => void;
  account: UserAccountState;
  onToggleConnection: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onResetPet,
  account,
  onToggleConnection,
}) => {
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState('1 hour');
  const [widgetTheme, setWidgetTheme] = useState('dark-pixel');
  const [saveNotice, setSaveNotice] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const username = account.status !== 'disconnected' && account.profile?.username
    ? account.profile.username
    : 'demo-trainer';

  const embedSnippets = generateReadmeEmbedSnippet(username, widgetTheme);
  const publicBaseUrl = getPublicAppUrl();

  const handleSave = () => {
    setSaveNotice(true);
    setTimeout(() => setSaveNotice(false), 2000);
  };

  const handleCopySnippet = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(embedSnippets.markdown);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2500);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between border-b border-[#222733] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <SettingsIcon size={16} className="text-indigo-400" />
            Platform & Pet Settings
          </h3>
          <p className="text-xs text-slate-500">
            Configure visual presentation, public distribution, and sync preferences
          </p>
        </div>
        {saveNotice && (
          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
            <CheckIcon size={12} /> Saved!
          </span>
        )}
      </div>

      {/* GitHub Profile README Integration Box */}
      <div className="p-4 rounded-lg bg-[#12151b] border border-[#222733] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              README Embed
            </span>
            <h4 className="text-xs font-semibold text-slate-200">
              GitHub Profile README Integration
            </h4>
          </div>
          <span className="text-[10px] text-amber-400/90 font-medium px-2 py-0.5 bg-[#181c24] border border-[#2d3342] rounded">
            Demo Preview (Hosted Backend Stage 2)
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Embed your companion into your GitHub profile <code className="text-slate-300 bg-[#181c24] border border-[#222733] px-1 py-0.5 rounded font-mono">README.md</code>. Renders server-side as pure SVG without client-side scripts or token exposure.
        </p>

        {/* Realistic GitHub Profile README Context Mockup */}
        <div className="rounded-lg bg-[#0d1117] border border-[#30363d] overflow-hidden">
          {/* GitHub README Header bar */}
          <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-[11px] text-slate-300">README.md</span>
            <span className="text-[10px] text-slate-500">GitHub Profile Preview</span>
          </div>

          {/* Rendered SVG Embed Mockup Card */}
          <div className="p-4 sm:p-6 flex justify-center">
            <div className="w-full max-w-md bg-[#090e18] border border-[#202e48] rounded p-4 flex items-center gap-4 shadow-sm">
              <div className="w-16 h-16 rounded bg-[#131b2e] border border-indigo-950 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-mono text-indigo-300">[Pet]</span>
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-100 truncate">
                    {username}&apos;s Companion
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-[#181c24] border border-[#2d3342] text-indigo-300 font-mono rounded">
                    Lvl 5
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Void Familiar • Juvenile
                </div>
                <div className="w-full bg-[#181c24] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full w-3/5 rounded-full" />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>14-day streak</span>
                  <span className="text-emerald-400 font-sans">Public</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Markdown Snippet Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Markdown snippet:</span>
            <span className="text-slate-500 font-mono text-[10px]">Host: {publicBaseUrl}</span>
          </div>
          <div className="relative">
            <pre className="p-3 bg-[#0c0e12] border border-[#222733] rounded-md text-slate-300 text-xs overflow-x-auto select-all font-mono">
              <code>{embedSnippets.markdown}</code>
            </pre>
            <button
              type="button"
              onClick={handleCopySnippet}
              className="absolute top-2 right-2 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer transition-colors"
              title="Copy snippet to clipboard"
            >
              {copiedSnippet ? (
                <>
                  <CheckIcon size={11} /> Copied!
                </>
              ) : (
                <>
                  <CopyIcon size={11} /> Copy
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            * In local development, this snippet targets your local environment. In production deployment, it automatically resolves to your public HTTPS domain.
          </p>
        </div>
      </div>

      {/* Preferences Section */}
      <div className="p-4 rounded-lg bg-[#12151b] border border-[#222733] space-y-4">
        {/* Toggle Animations */}
        <div className="flex items-center justify-between pb-3 border-b border-[#222733]">
          <div>
            <div className="text-xs font-medium text-slate-200">
              Pet Idle Animations
            </div>
            <div className="text-[11px] text-slate-500">
              Subtle breathing and floating movements
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAnimationsEnabled(!animationsEnabled)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              animationsEnabled
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                : 'bg-[#181c24] text-slate-500 border border-[#222733]'
            }`}
          >
            {animationsEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {/* Toggle Sound */}
        <div className="flex items-center justify-between pb-3 border-b border-[#222733]">
          <div>
            <div className="text-xs font-medium text-slate-200">
              Sound Effects (Simulated)
            </div>
            <div className="text-[11px] text-slate-500">
              Low-profile audio cues on interactions
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              soundEnabled
                ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/60'
                : 'bg-[#181c24] text-slate-500 border border-[#222733]'
            }`}
          >
            {soundEnabled ? 'Active' : 'Muted'}
          </button>
        </div>

        {/* GitHub Sync Interval */}
        <div className="flex items-center justify-between pb-3 border-b border-[#222733]">
          <div>
            <div className="text-xs font-medium text-slate-200">
              Activity Sync Cadence
            </div>
            <div className="text-[11px] text-slate-500">
              Background frequency for contribution updates
            </div>
          </div>
          <select
            value={syncInterval}
            onChange={(e) => setSyncInterval(e.target.value)}
            className="px-2.5 py-1 bg-[#181c24] border border-[#2d3342] rounded text-xs text-slate-200 focus:outline-none"
          >
            <option value="15 min">Every 15 min</option>
            <option value="1 hour">Every 1 hour</option>
            <option value="6 hours">Every 6 hours</option>
            <option value="daily">Daily digest</option>
          </select>
        </div>

        {/* README Widget Theme */}
        <div className="flex items-center justify-between pb-3 border-b border-[#222733]">
          <div>
            <div className="text-xs font-medium text-slate-200">
              README Card Theme
            </div>
            <div className="text-[11px] text-slate-500">
              Palette used when rendering SVG for your GitHub profile
            </div>
          </div>
          <select
            value={widgetTheme}
            onChange={(e) => setWidgetTheme(e.target.value)}
            className="px-2.5 py-1 bg-[#181c24] border border-[#2d3342] rounded text-xs text-slate-200 focus:outline-none"
          >
            <option value="dark-pixel">Dark Theme (Default)</option>
            <option value="cyber-neon">Slate & Indigo</option>
            <option value="retro-gameboy">Terminal Green</option>
            <option value="high-contrast">Monochrome</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <PixelButton variant="primary" size="sm" onClick={handleSave}>
            Save Preferences
          </PixelButton>

          <div className="flex items-center gap-2">
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={onToggleConnection}
            >
              {account.status !== 'disconnected' ? 'Disconnect Demo' : 'Connect Demo'}
            </PixelButton>

            <PixelButton
              variant="danger"
              size="sm"
              onClick={onResetPet}
            >
              Reset State
            </PixelButton>
          </div>
        </div>
      </div>
    </div>
  );
};
