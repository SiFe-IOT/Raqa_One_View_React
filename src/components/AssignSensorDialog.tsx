import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { InlineDialog } from './InlineDialog';
import { FocusButton } from './FocusButton';
import { FocusTrap } from './FocusTrap';
import { useRemoteKeys } from '../hooks/useRemoteKeys';
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

  // Remote focus: 0 Device, 1 Zone, 2 Name, 3 Location, 4 Cancel, 5 Place.
  const [sel, setSel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [claim, setClaim] = useState(0);
  const [nameTick, setNameTick] = useState(0);
  const [locTick, setLocTick] = useState(0);

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
    setSel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const canPlace = slaveId !== null && !!zone;
  const hasDevices = !!request && request.availableSlaveIds.length > 0;

  const changeDevice = (id: number) => {
    const z = availableZonesForSlave(id)[0] ?? null;
    setSlaveId(id);
    setZoneAddr(z?.address ?? null);
    setName(defaultName(id, z));
  };
  const changeZone = (a: number) => {
    setZoneAddr(a);
    setName(defaultName(slaveId, zones.find((z) => z.address === a) ?? null));
  };
  const stepSelect = (d: number) => {
    if (!request) return;
    if (sel === 0) {
      const ids = request.availableSlaveIds;
      const i = slaveId === null ? -1 : ids.indexOf(slaveId);
      const n = Math.min(ids.length - 1, Math.max(0, i + d));
      if (n !== i && ids[n] !== undefined) changeDevice(ids[n]);
    } else if (sel === 1) {
      const i = zones.findIndex((z) => z.address === zoneAddr);
      const n = Math.min(zones.length - 1, Math.max(0, i + d));
      if (n !== i && zones[n]) changeZone(zones[n].address);
    }
  };

  // The dialog owns the D-pad itself (a FocusTrap keeps native focus on it), so
  // focus is never lost when the keyboard closes after editing Name / Location.
  useRemoteKeys((k) => {
    if (!hasDevices) { if (k === 'select') onClose(null); return; }
    if (k === 'up') setSel((s) => (s >= 4 ? 3 : Math.max(0, s - 1)));
    else if (k === 'down') setSel((s) => (s < 4 ? s + 1 : s));
    else if (k === 'left') {
      if (sel <= 1) stepSelect(-1);
      else if (sel === 5) setSel(4);
    } else if (k === 'right') {
      if (sel <= 1) stepSelect(1);
      else if (sel === 4 && canPlace) setSel(5);
    } else if (k === 'select') {
      if (sel === 2) setNameTick((t) => t + 1);
      else if (sel === 3) setLocTick((t) => t + 1);
      else if (sel === 4) onClose(null);
      else if (sel === 5 && canPlace) place();
    }
  }, !!request && !typing);

  if (!request) return null;

  const ui = SensorTypeUi[request.type];

  function place() {
    if (!request || slaveId === null || !zone) return;
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
  }

  return (
    <InlineDialog visible onRequestClose={() => onClose(null)}>
      <FocusTrap active claimKey={claim} style={styles.scrim}>
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
                external
                highlighted={sel === 0}
                options={request.availableSlaveIds}
                value={slaveId}
                labelBuilder={(id) => `Slave ${id} - ${ModbusRtu.slaveModelMap.get(id) ?? ''}`}
                onChange={changeDevice}
              />
              <View style={{ height: 12 }} />
              <TvSelectField<number>
                label="Zone"
                external
                highlighted={sel === 1}
                options={zones.map((z) => z.address)}
                value={zoneAddr}
                labelBuilder={(a) => zones.find((z) => z.address === a)?.label ?? ''}
                onChange={changeZone}
              />
              <View style={{ height: 12 }} />
              <TvTextField
                external
                highlighted={sel === 2}
                startEdit={nameTick}
                onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
                label="Name" value={name} onChangeText={setName} returnKeyType="done"
              />
              <View style={{ height: 12 }} />
              <TvTextField
                external
                highlighted={sel === 3}
                startEdit={locTick}
                onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
                label="Location" value={location} onChangeText={setLocation} returnKeyType="done"
              />
            </ScrollView>
          )}

          <View style={styles.actions}>
            <FocusButton label="Cancel" highlighted={sel === 4 || !hasDevices} onPress={() => onClose(null)} />
            {request.availableSlaveIds.length > 0 && (
              <FocusButton label="Place" variant="primary" highlighted={sel === 5} disabled={!canPlace} onPress={place} />
            )}
          </View>
        </View>
      </FocusTrap>
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