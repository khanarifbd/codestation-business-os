"use client";
import Image from "next/image";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { profileInitials, type Profile } from "./profile-model";
export function ProfileAvatar({ profile, large = false }: { profile: Profile; large?: boolean }) { return <div className={`pa-avatar${large ? " pa-avatar-large" : ""}`}>{profile.has_avatar ? <Image unoptimized src={`/api/profile/avatar?v=${profile.avatar_version}`} width={large ? 96 : 48} height={large ? 96 : 48} alt={`${profile.full_name}'s profile photo`} /> : <span aria-label="Profile initials">{profileInitials(profile.full_name)}</span>}</div>; }
export function ProfileDestination({ href, title, children, icon: Icon = ArrowUpRight }: { href: string; title: string; children: ReactNode; icon?: typeof ArrowUpRight }) { return <a className="pa-destination" href={href}><Icon size={20} aria-hidden="true"/><span><strong>{title}</strong><small>{children}</small></span><ArrowUpRight size={16} aria-hidden="true"/></a>; }
