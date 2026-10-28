import { Exclude, Expose } from 'class-transformer';

export class UserEntity {
  id: number;
  email: string;
  name: string | null;

  @Exclude() // Không trả về password
  password: string;

  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
