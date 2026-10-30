import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DeviceType, RegisterData } from '../devices/types';
import { DeviceColorMapper, getModelByType } from '../devices/registry';
import { Rs485Service } from '../services/rs485Service';
import { useValueNotifier } from '../services/observable';
import { ValueNotifier } from '../services/observable';

const EMPTY = new ValueNotifier<RegisterData[]>([]);

interface Props {
  manager: Rs485Service;
  /** MUST be slaveId - 1 */
  slaveIndex: number;
  type: DeviceType;
}

const COLUMNS = 8;

/** Tiny colour-coded grid of a slave's live registers. */
export function DeviceRegisterPreview({ manager, slaveIndex, type }: Props) {
  const notifier = manager.slaveRegistersNotifier[slaveIndex] ?? EMPTY;
  const registers = useValueNotifier(notifier);

  if (slaveIndex < 0 || slaveIndex >= manager.slaveRegistersNotifier.length) return null;
  if (registers.length === 0) return null;

  const model = getModelByType(type);
  const count = DeviceColorMapper.getPreviewRegisterCount(type);
  const preview = model.registers.length > 3 ? model.registers.slice(3, 3 + count) : [];

  return (
    <View style={styles.grid}>
      {preview.map((meta) => {
        const reg = registers.find((r) => r.address === meta.address);
        const raw = reg?.value ?? 0;
        const display = meta.valueMap?.[raw] ?? String(raw);
        const color = DeviceColorMapper.getColor(type, meta.name, display);
        return (
          <View key={meta.address} style={styles.cellWrap}>
            <View style={[styles.cell, { backgroundColor: color }]} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
  cellWrap: { width: `${100 / COLUMNS}%`, aspectRatio: 1, padding: 1 },
  cell: { flex: 1, borderRadius: 2 },
});
