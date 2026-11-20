/**
 * Adapter contract for a future hospital-authorized provider integration.
 * Construct provider clients inside the backend from server-side configuration and
 * inject the resulting adapter into createApp; never accept credentials from HTTP.
 * fetchAvailability receives only a hospital identifier/location and must return
 * {status, notes?, updatedBy?, updaterRole?}. No provider is configured by default.
 */
export function createHospitalAvailabilityAdapter(providerClient){
  if(!providerClient||typeof providerClient.fetchAvailability!=='function')throw new TypeError('Hospital provider must implement fetchAvailability(hospital).');
  return Object.freeze({fetchAvailability:(hospital)=>providerClient.fetchAvailability(hospital)});
}
