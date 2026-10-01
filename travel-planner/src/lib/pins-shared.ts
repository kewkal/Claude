/** A place you've pinned from Explore; hotels show distance to these. */
export interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category?: string;
  destination?: string;
  addedAt: string;
}
