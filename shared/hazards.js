export const hazardTypes = [
  { value: 'road_damage', label: 'Potholes / Road Damage', penalty: 20, symbol: 'D' },
  { value: 'construction', label: 'Road Construction', penalty: 25, symbol: 'C' },
  { value: 'road_blockage', label: 'Road Blockage', penalty: 50, symbol: 'B' },
  { value: 'flooding', label: 'Waterlogging / Flooding', penalty: 45, symbol: 'F' },
  { value: 'traffic', label: 'Traffic Congestion', penalty: 20, symbol: 'T' },
  { value: 'narrow_road', label: 'Narrow Road / Access Restriction', penalty: 30, symbol: 'N' },
  { value: 'accident', label: 'Accident Obstruction', penalty: 40, symbol: 'A' },
];
export const severities = ['Low', 'Medium', 'High'];
export const verificationStatuses = ['Reported', 'Verified', 'Rejected'];
export const hazardLabel = (type) => hazardTypes.find((item) => item.value === type)?.label || type;
export function isHazardActive(hazard, now = Date.now()) {
  return Boolean(hazard.is_active) && (!hazard.expires_at || Date.parse(hazard.expires_at) > now);
}
