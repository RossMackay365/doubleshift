'use client';
import { X, RotateCcw } from 'lucide-react';
import { RewardConfig, RewardItem } from '@/lib/types';
import { DEFAULT_REWARD_CONFIG } from '@/lib/rewardConfig';

interface Props {
  open: boolean;
  onClose: () => void;
  config: RewardConfig;
  onChange: (config: RewardConfig) => void;
  locked: boolean;
}

export default function ConfigPanel({ open, onClose, config, onChange, locked }: Props) {
  if (!open) return null;

  function updateItem(key: string, patch: Partial<RewardItem>) {
    onChange(config.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Reward Settings</h2>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {locked && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Reward settings cannot be changed while editing a schedule.
            </div>
          )}
          <p className="mb-4 text-sm text-gray-500">
            Toggle rewards on/off and adjust their values. Changes take effect on the next run.
          </p>
          <div className="space-y-3">
            {config.map(item => (
              <RewardRow
                key={item.key}
                item={item}
                onChange={patch => updateItem(item.key, patch)}
                locked={locked}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
          <button
            onClick={() => onChange(DEFAULT_REWARD_CONFIG)}
            disabled={locked}
            className="flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={14} />
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}

function RewardRow({
  item,
  onChange,
  locked,
}: {
  item: RewardItem;
  onChange: (patch: Partial<RewardItem>) => void;
  locked: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={item.enabled}
        onClick={() => !locked && onChange({ enabled: !item.enabled })}
        disabled={locked}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none
          ${item.enabled ? 'bg-blue-600' : 'bg-gray-300'}
          ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
            ${item.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      <span className={`flex-1 text-sm leading-tight transition-opacity ${!item.enabled ? 'opacity-40' : ''} ${item.isPenalty ? 'text-red-700' : 'text-gray-700'}`}>
        {item.label}
        {item.isPenalty && <span className="ml-1 text-xs text-red-400">(penalty)</span>}
      </span>
      <input
        type="number"
        value={item.value}
        onChange={e => {
          const parsed = parseInt(e.target.value, 10);
          onChange({ value: isNaN(parsed) ? 0 : Math.max(0, parsed) });
        }}
        disabled={locked || !item.enabled}
        className={`w-24 rounded border border-gray-200 bg-white px-2 py-1 text-right text-sm text-gray-800 focus:border-blue-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 transition-opacity ${!item.enabled ? 'opacity-40' : ''}`}
        min={0}
        step={1}
      />
    </div>
  );
}
