
import { Canvas } from "@react-three/fiber";
import {
  Float,
  MeshDistortMaterial,
  Sphere,
  Stars,
  Torus,
  Sparkles,
} from "@react-three/drei";
import { motion } from "framer-motion";
import { ShieldCheck, MapPin, Heart, Navigation } from "lucide-react";
import "./SafetyScene.css";

function SafetyOrb() {
  return (
    <group>
      {/* Main animated 3D orb */}
      <Float speed={1.3} rotationIntensity={0.35} floatIntensity={0.5}>
        <Sphere args={[1.05, 64, 64]}>
          <MeshDistortMaterial
            color="#df6c9b"
            roughness={0.2}
            metalness={0.22}
            distort={0.32}
            speed={2}
          />
        </Sphere>
      </Float>

      {/* Floating orbit rings */}
      <Float speed={0.8} rotationIntensity={0.5} floatIntensity={0.2}>
        <Torus args={[1.48, 0.012, 12, 120]} rotation={[0.85, 0.2, -0.3]}>
          <meshStandardMaterial
            color="#b88ae8"
            metalness={0.65}
            roughness={0.25}
            transparent
            opacity={0.9}
          />
        </Torus>
      </Float>

      <Float speed={1.1} rotationIntensity={0.3} floatIntensity={0.2}>
        <Torus args={[1.7, 0.008, 10, 120]} rotation={[1.15, -0.35, 0.45]}>
          <meshStandardMaterial
            color="#f39fc4"
            metalness={0.5}
            roughness={0.3}
            transparent
            opacity={0.8}
          />
        </Torus>
      </Float>

      {/* Tiny floating particles */}
      <Sparkles
        count={85}
        scale={4.5}
        size={3}
        speed={0.35}
        color="#d9579a"
        opacity={0.85}
      />

      <Stars
        radius={7}
        depth={3}
        count={45}
        factor={1.5}
        fade
        speed={0.3}
      />
    </group>
  );
}

export default function SafetyScene() {
  return (
    <motion.div
      className="safety-scene"
      initial={{ opacity: 0, y: 22, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.85, ease: "easeOut" }}
    >
      <div className="scene-glow scene-glow-one" />
      <div className="scene-glow scene-glow-two" />

      <div className="scene-top-label">
        <span className="scene-status-dot" />
        YOUR SAFETY, OUR PRIORITY
      </div>

      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 4, 5]} intensity={2.2} />
        <pointLight
          position={[-3, -2, 2]}
          color="#ff8fc2"
          intensity={18}
        />
        <pointLight
          position={[3, 1, -2]}
          color="#b99aff"
          intensity={12}
        />
        <SafetyOrb />
      </Canvas>

      {/* Floating photo cards */}
      <motion.div
        className="scene-photo-card scene-photo-left"
        animate={{ y: [0, -9, 0], rotate: [-4, -2, -4] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <img
          src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=400&q=80"
          alt="Friends walking together outdoors"
          loading="lazy"
        />
        <span className="photo-card-caption">Together, safer</span>
      </motion.div>

      <motion.div
        className="scene-photo-card scene-photo-right"
        animate={{ y: [0, 10, 0], rotate: [4, 2, 4] }}
        transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <img
          src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=400&q=80"
          alt="Person using a phone"
          loading="lazy"
        />
        <span className="photo-card-caption">Stay connected</span>
      </motion.div>

      {/* Floating glass information chips */}
      <motion.div
        className="scene-float-chip chip-safety"
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="chip-icon"><ShieldCheck size={17} /></span>
        <span><strong>Safety first</strong><small>Plan with confidence</small></span>
      </motion.div>

      <motion.div
        className="scene-float-chip chip-location"
        animate={{ y: [0, 7, 0] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="chip-icon"><MapPin size={17} /></span>
        <span><strong>Your journey</strong><small>Route assistance</small></span>
      </motion.div>

      <div className="scene-bottom-pill">
        <Navigation size={14} />
        <span>AI-ASSISTED TRAVEL</span>
        <Heart size={14} />
      </div>
    </motion.div>
  );
}
