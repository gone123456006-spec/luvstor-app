import { NearbyUser } from './nearby';

export interface DiscoverySection {
  key: 'online' | 'fresh' | 'worth_a_look';
  title: string;
  subtitle?: string;
  users: NearbyUser[];
}

/**
 * Split nearby batch into psychological sections:
 * - Online Nearby: online + within 10km
 * - Fresh for You: unseen/new profiles
 * - Worth a Look: exploration/farther profiles
 */
export function splitIntoSections(users: NearbyUser[]): DiscoverySection[] {
  const sections: DiscoverySection[] = [];
  
  // Section 1: Online Nearby (online + close)
  const online = users.filter(u => {
    const km = u.distanceKm ? parseFloat(u.distanceKm) : Infinity;
    return u.isOnline && km <= 10 && u.source === 'nearby';
  });
  
  if (online.length > 0) {
    sections.push({
      key: 'online',
      title: 'Online Nearby',
      subtitle: 'Active now in your area',
      users: online,
    });
  }
  
  // Section 2: Fresh for You (nearby, not in online)
  const onlineIds = new Set(online.map(u => u.id));
  const fresh = users.filter(u => 
    !onlineIds.has(u.id) && u.source === 'nearby'
  );
  
  if (fresh.length > 0) {
    sections.push({
      key: 'fresh',
      title: 'Fresh for You',
      subtitle: 'New and recommended nearby',
      users: fresh,
    });
  }
  
  // Section 3: Worth a Look (random/expanded)
  const freshIds = new Set(fresh.map(u => u.id));
  const worthALook = users.filter(u => 
    !onlineIds.has(u.id) && !freshIds.has(u.id)
  );
  
  if (worthALook.length > 0) {
    sections.push({
      key: 'worth_a_look',
      title: 'Worth a Look',
      subtitle: 'Explore beyond your area',
      users: worthALook,
    });
  }
  
  return sections;
}

/**
 * Get section header props for SectionList
 */
export function getSectionHeaderProps() {
  return {
    online: {
      icon: 'radio' as const,
      color: '#4CAF50',
    },
    fresh: {
      icon: 'sparkles' as const,
      color: '#370372',
    },
    worth_a_look: {
      icon: 'compass' as const,
      color: '#FF9800',
    },
  };
}
