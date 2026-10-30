import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { InlineDialog } from './InlineDialog';
import { FocusButton } from './FocusButton';
import { TvSelectField, TvTextField } from './TvFields';
import { ModbusRtu } from '../services/modbusRtu';
import { PlacedSensor, SensorType, SensorTypeUi, SensorZone } from '../services/configTypes';
import { AppTheme } from '../theme/appTheme';
import { useAppSettings } from '../services/appSettings';

export interface AssignRequest {
  type: SensorType;
  xFraction: number;
  yFraction: number;
  availableSlaveIds: number[];
}

interface Props {
  request: AssignRequest | null;
  availableZonesForSlave: (slaveId: number) => SensorZone[];
  onClose: (result: PlacedSensor | null) => void;
}

/** New placement: pick which scanned device + zone this pin represents. */
export function AssignSensorDialog({ request, availableZonesForSlave, onClose }: Props) {
  useAppSettings();
  const [slaveId, setSlaveId] = useState<number | null>(null);
  const [zoneAddr, setZoneAddr] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  const zones = slaveId !== null ? availableZonesForSlave(slaveId) : [];
  const zone = zones.find((z) => z.address === zoneAddr) ?? null;

  const defaultName = (sid: number | null, z: SensorZone | null) => {
    if (sid === null || !z) return '';
    return `${ModbusRtu.slaveModelMap.get(sid) ?? `Slave ${sid}`} - ${z.label}`;
  };

  // Reset whenever a new request arrives.
  useEffect(() => {
    if (!request) return;
    const sid = request.availableSlaveIds[0] ?? null;
    const z = sid !== null ? availableZonesForSlave(sid)[0] ?? null : null;
    setSlaveId(sid);
    setZoneAddr(z?.address ?? null);
    setName(defaultName(sid, z));
    setLocation('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) return null;

  const ui = SensorTypeUi[request.type];

  const place = () => {
    if (slaveId === null || !zone) return;
    onClose({
      slaveId,
      zoneAddress: zone.address,
      zoneLabel: zone.label,
      type: request.type,
      name: name.trim() === '' ? defaultName(slaveId, zone) : name.trim(),
      location: location.trim(),
      notes: '',
      xFraction: request.xFraction,
      yFraction: request.yFraction,
    });
  };

  return (
    <InlineDialog visible onRequestClose={() => onClose(null)}>
      <View style={styles.scrim}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.dialog }]}>
          <View style={styles.titleRow}>
            <Icon name={ui.icon} size={24} color={ui.color} />
            <Text style={[styles.title, { color: AppTheme.textPrimary }]}>Place {ui.label} Sensor</Text>
          </View>

          {request.availableSlaveIds.length === 0 ? (
            <Text style={{ color: AppTheme.textSecondary }}>Every scanned device already has all its zones pinned.</Text>
          ) : (
            <ScrollView>
              <TvSelectField<number>
                label="Device"
                autoFocus
                options={request.availableSlaveIds}
                value={slaveId}
                labelBuilder={(id) => `Slave ${id} - ${ModbusRtu.slaveModelMap.get(id) ?? ''}`}
                onChange={(id) => {
                  const z = availableZonesForSlave(id)[0] ?? null;
                  setSlaveId(id);
                  setZoneAddr(z?.address ?? null);
                  setName(defaultName(id, z));
                }}
              />
              <View style={{ height: 12 }} />
              <TvSelectField<number>
                label="Zone"
                options={zones.map((z) => z.address)}
                value={zoneAddr}
                labelBuilder={(a) => zones.find((z) => z.address === a)?.label ?? ''}
                onChange={(a) => {
                  setZoneAddr(a);
                  setName(defaultName(slaveId, zones.find((z) => z.address === a) ?? null));
                }}
              />
              <View style={{ height: 12 }} />
              <TvTextField label="Name" value={name} onChangeText={setName} returnKeyType="next" />
              <View style={{ height: 12 }} />
              <TvTextField label="Location" value={location} onChangeText={setLocation} />
            </ScrollView>
          )}

          <View style={styles.actions}>
            <FocusButton label="Cancel" onPress={() => onClose(null)} />
            {request.availableSlaveIds.length > 0 && (
              <FocusButton label="Place" variant="primary" disabled={slaveId === null || !zone} onPress={place} />
            )}
          </View>
        </View>
      </View>
    </InlineDialog>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '60%', maxWidth: 460, maxHeight: '90%', borderRadius: 16, padding: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '600', marginLeft: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 },
});
