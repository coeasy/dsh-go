export interface Profile {
  name: string;
  plugins: string[];
}

export class ProfileResolver {
  resolve(profile: Profile, registry: any[]): any[] {
    return registry.filter(p => profile.plugins.includes(p.id));
  }
}
