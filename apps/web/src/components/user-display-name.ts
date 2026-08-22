type SessionUser = {
	name?: string | null;
	email: string;
};

export function getUserDisplayName(user: SessionUser) {
	return user.name?.trim() || user.email;
}
