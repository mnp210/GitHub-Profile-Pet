import React from 'react';
import { TrophyIcon, FlameIcon, CommitIcon, PawIcon, BoltIcon } from '@/components/ui/PixelIcons';

export const AchievementsView: React.FC = () => {
  const achievements = [
    {
      id: 'first_commit',
      title: 'First Spark',
      description: 'Awaken your first pixel pet companion with a GitHub commit.',
      unlocked: true,
      date: 'Earned May 12, 2026',
      icon: <CommitIcon size={20} className="text-emerald-400" />,
      xpReward: '+50 XP',
    },
    {
      id: 'streak_7',
      title: 'Consistent Coder',
      description: 'Maintain a 7-day contribution streak without missing a day.',
      unlocked: true,
      date: 'Earned Jun 04, 2026',
      icon: <FlameIcon size={20} className="text-amber-400" />,
      xpReward: '+150 XP',
    },
    {
      id: 'evolution_1',
      title: 'Metamorphosis',
      description: 'Evolve any companion into their Stage II Adept form.',
      unlocked: true,
      date: 'Earned Jul 19, 2026',
      icon: <PawIcon size={20} className="text-purple-400" />,
      xpReward: '+200 XP',
    },
    {
      id: 'streak_30',
      title: 'Unstoppable Momentum',
      description: 'Reach an uninterrupted 30-day coding streak.',
      unlocked: false,
      date: 'Progress: 28/30 days',
      icon: <BoltIcon size={20} className="text-yellow-400" />,
      xpReward: '+500 XP',
    },
    {
      id: 'pr_champion',
      title: 'Pull Request Titan',
      description: 'Merge 25 pull requests to nourish your pet with teamwork.',
      unlocked: false,
      date: 'Progress: 18/25 PRs',
      icon: <TrophyIcon size={20} className="text-indigo-400" />,
      xpReward: '+300 XP',
    },
    {
      id: 'all_species',
      title: 'Master Zookeeper',
      description: 'Adopt and bond with all four initial pet species.',
      unlocked: false,
      date: 'Progress: 1/4 bonded',
      icon: <PawIcon size={20} className="text-cyan-400" />,
      xpReward: '+1000 XP',
    },
  ];

  return (
    <div className="space-y-4 font-mono">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div>
          <h3 className="text-sm font-bold uppercase text-slate-100 flex items-center gap-2">
            <TrophyIcon size={16} className="text-yellow-400" />
            Companion Achievement Vault
          </h3>
          <p className="text-xs text-slate-400">
            Badges earned by meeting GitHub contribution milestones [DEMO]
          </p>
        </div>
        <span className="text-xs font-bold text-amber-400">
          3 / 6 UNLOCKED
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {achievements.map((item) => (
          <div
            key={item.id}
            className={`p-4 border-2 transition-all ${
              item.unlocked
                ? 'bg-[#0f172a] border-indigo-500/80 pixel-border-primary'
                : 'bg-[#0a0e18] border-slate-800/80 opacity-60'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 bg-[#172238] border border-slate-700">
                {item.icon}
              </div>
              <span
                className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                  item.unlocked
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                    : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                {item.unlocked ? 'UNLOCKED' : 'LOCKED'}
              </span>
            </div>

            <h4 className="text-xs md:text-sm font-bold text-slate-100 mb-1">
              {item.title}
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              {item.description}
            </p>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
              <span className="text-indigo-400 font-bold">{item.xpReward}</span>
              <span className="text-slate-500">{item.date}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
